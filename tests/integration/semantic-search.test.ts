import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import Redis from "ioredis"
import sharp from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { hashToken } from "../../apps/api/src/services/security/auth"
import { findAssetsNeedingSemanticIndex, indexAssetSemantics } from "../../apps/worker/src/services/semantic-index"
import {
  createAsset,
  createFolder,
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

/**
 * Local semantic search end to end against real PostgreSQL: the worker's
 * index job, the asset search routes, and the owner routes.
 *
 * Ollama is a deterministic fake so the suite needs no model:
 *  - embeddings map words to a handful of fixed "concepts" (celebration,
 *    beach, invoice…), so "birthday party" and a caption about a cake with
 *    candles really are close, and unrelated text really is not;
 *  - the vision model "sees" pixel colour: a red picture is a birthday party,
 *    a blue one a beach.
 * The real model is covered by tests/semantic-live-ollama.test.ts.
 */

const CONCEPTS: Record<string, string[]> = {
  celebration: ["birthday", "party", "cake", "candles", "celebration", "blowing", "blows"],
  beach: ["beach", "sunset", "ocean", "waves", "shore"],
  invoice: ["invoice", "billing", "bill", "payment", "receipt"],
  car: ["car", "sedan", "vehicle"],
}
const conceptVector = (index: number) => Array.from({ length: 768 }, (_, i) => Math.sin((i + 1) * (index + 1) * 1.37))

function fakeEmbedding(text: string): number[] {
  const words = text.toLowerCase().replace(/^search_(query|document): /, "").split(/[^a-z]+/)
  const out = new Array(768).fill(0)
  Object.values(CONCEPTS).forEach((list, index) => {
    if (words.some((w) => list.includes(w))) conceptVector(index).forEach((v, i) => (out[i] += v))
  })
  if (out.every((v) => v === 0)) out[767] = 1 // meaningless text: orthogonal to every concept
  return out
}

const ollama = {
  online: true,
  digest: "digest-a",
  embedCalls: 0,
  chatCalls: 0,
}

async function fakeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const href = String(url)
  if (!href.startsWith("http://127.0.0.1:11434")) throw new Error(`unexpected request to ${href}`)
  if (!ollama.online) throw new TypeError("fetch failed")
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  if (href.endsWith("/api/tags")) {
    return Response.json({
      models: [
        { name: "nomic-embed-text:latest", digest: ollama.digest, size: 274_302_450 },
        { name: "fakevision:latest", digest: "v1", size: 1_000_000 },
      ],
    })
  }
  if (href.endsWith("/api/show")) {
    return Response.json(
      body.model.startsWith("fakevision")
        ? { capabilities: ["completion", "vision"] }
        : { capabilities: ["embedding"], model_info: { "nomic-bert.embedding_length": 768 } },
    )
  }
  if (href.endsWith("/api/embed")) {
    ollama.embedCalls++
    return Response.json({ embeddings: (body.input as string[]).map(fakeEmbedding) })
  }
  if (href.endsWith("/api/chat")) {
    ollama.chatCalls++
    const image = Buffer.from(body.messages[0].images[0], "base64")
    const { dominant } = await sharp(image).stats()
    const caption =
      dominant.r > dominant.b
        ? "A birthday party indoors: friends around a cake while someone blows out the candles."
        : "Waves on a beach at sunset."
    return Response.json({ message: { content: caption } })
  }
  return new Response("not found", { status: 404 })
}

let fixtures: Fixtures
let root: string
let redis: Redis
let app: Awaited<ReturnType<typeof buildApp>>
let ownerCookie: string
let memberCookie: string

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerJsonBodyParser } = await import("../../apps/api/src/plugins/json-body")
  const { registerErrorHandler } = await import("../../apps/api/src/plugins/error-handler")
  const { registerAssetRoutes } = await import("../../apps/api/src/modules/assets/routes")
  const { registerSemanticSearchRoutes } = await import("../../apps/api/src/modules/semantic-search/routes")
  const a = Fastify({ logger: false })
  a.decorate("prisma", prisma)
  a.decorate("redis", redis)
  a.decorate("publishRealtimeEvent", async () => {})
  registerJsonBodyParser(a)
  await registerErrorHandler(a)
  await registerCookies(a)
  await a.register(
    async (api) => {
      await registerAssetRoutes(api)
      await registerSemanticSearchRoutes(api)
    },
    { prefix: "/api" },
  )
  await a.ready()
  return a
}

async function cookieFor(userId: string) {
  const raw = `sess_${crypto.randomUUID()}`
  await prisma.session.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) } })
  return `arciin_session=${raw}`
}

/** A real picture on disk, so the index job reads and captions it like any upload. */
async function imageAsset(name: string, color: { r: number; g: number; b: number }, extra: Parameters<typeof createAsset>[1] = { librarySlug: "images" }) {
  const asset = await createAsset(fixtures, { mediaType: "IMAGE", mimeType: "image/jpeg", extension: "jpg", originalFilename: name, ...extra })
  const so = await prisma.storageObject.findUniqueOrThrow({ where: { id: asset.storageObjectId } })
  await mkdir(path.dirname(so.physicalPath), { recursive: true })
  await writeFile(so.physicalPath, await sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).jpeg().toBuffer())
  return asset
}

const RED = { r: 220, g: 30, b: 30 }
const BLUE = { r: 20, g: 40, b: 230 }

const deps = () => ({ prisma, storageRoot: root, baseUrl: "http://127.0.0.1:11434", fetchImpl: fakeFetch as never })

async function search(query: string, params: Record<string, string> = {}, cookie = ownerCookie) {
  const qs = new URLSearchParams({ search: query, withTotal: "true", ...params })
  const res = await app.inject({ method: "GET", url: `/api/assets/page?${qs}`, headers: { cookie } })
  expect(res.statusCode, res.body).toBe(200)
  return res.json().data as {
    items: Array<{ id: string; originalFilename: string; searchMatch?: { kind: string; label: string } }>
    semantic?: string
    total?: number
  }
}

async function enable(on = true) {
  await prisma.semanticSearchConfig.upsert({
    where: { id: "default" },
    create: { id: "default", enabled: on, indexingActive: on },
    update: { enabled: on, indexingActive: on },
  })
  const { semanticSearchFor } = await import("../../apps/api/src/services/search/hybrid-search")
  semanticSearchFor(prisma).invalidate()
}

beforeAll(async () => {
  vi.stubGlobal("fetch", fakeFetch)
  root = await createTestStorageRoot()
  await resetDatabase()
  await prisma.assetSemanticIndex.deleteMany()
  await prisma.semanticSearchConfig.deleteMany()
  fixtures = await seedBaseFixtures(root)
  await prisma.instanceConfig.deleteMany()
  await prisma.instanceConfig.create({ data: { instanceName: "Semantic", storageRoot: root, initializedAt: new Date(), licensePlan: "free", licenseStatus: "none" } })
  const member = await prisma.user.create({ data: { email: "member@example.invalid", name: "Member", passwordHash: "x", role: "MEMBER", status: "ACTIVE" } })
  ownerCookie = await cookieFor(fixtures.user.id)
  memberCookie = await cookieFor(member.id)
  redis = new Redis(process.env.REDIS_URL!)
  app = await buildApp()
})

afterAll(async () => {
  vi.unstubAllGlobals()
  await app?.close()
  await prisma.assetSemanticIndex.deleteMany()
  await prisma.semanticSearchConfig.deleteMany()
  await prisma.instanceConfig.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await redis.quit()
  await prisma.$disconnect()
})

beforeEach(async () => {
  ollama.online = true
  ollama.digest = "digest-a"
  ollama.embedCalls = 0
  ollama.chatCalls = 0
  await prisma.assetSemanticIndex.deleteMany()
  await prisma.asset.updateMany({ data: { deletedAt: new Date() } })
  await enable(true)
})

describe("the IMG_0042 example", () => {
  it("a keyword search cannot find it; after indexing, 'birthday party' and 'people blowing out candles' do", async () => {
    const img = await imageAsset("IMG_0042.jpg", RED)

    // Keyword-only baseline: nothing in its name or title says birthday.
    await enable(false)
    const before = await search("birthday party")
    expect(before.items.map((i) => i.id)).not.toContain(img.id)
    expect(before.semantic).toBe("disabled")

    await enable(true)
    expect(await indexAssetSemantics(img.id, deps())).toBe("indexed")

    for (const query of ["birthday party", "people blowing out candles", "cake celebration"]) {
      const res = await search(query)
      const hit = res.items.find((i) => i.id === img.id)
      expect(hit, query).toBeTruthy()
      expect(hit!.searchMatch).toEqual({ kind: "semantic", label: "Matched by meaning" })
      expect(res.semantic).toBe("used")
    }
    expect((await search("beach sunset")).items.map((i) => i.id)).not.toContain(img.id)
  })

  it("the caption is kept on the index, never written into the asset's title or description", async () => {
    const img = await imageAsset("IMG_0042.jpg", RED)
    await indexAssetSemantics(img.id, deps())
    const row = await prisma.assetSemanticIndex.findUniqueOrThrow({ where: { assetId: img.id } })
    expect(row.caption).toMatch(/birthday party/)
    expect(row).toMatchObject({ status: "INDEXED", embeddingModel: "nomic-embed-text", embeddingDigest: "digest-a", dimension: 768 })
    expect(row.embedding!.byteLength).toBe(3072)
    expect(row.semanticText).not.toContain(root)
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: img.id } })
    expect(asset.title).toBeNull()
    expect(asset.description).toBeNull()
  })
})

describe("index job", () => {
  it("captions once and embeds once; an unchanged asset is skipped", async () => {
    const img = await imageAsset("IMG_0100.jpg", BLUE)
    expect(await indexAssetSemantics(img.id, deps())).toBe("indexed")
    expect([ollama.chatCalls, ollama.embedCalls]).toEqual([1, 1])
    expect(await indexAssetSemantics(img.id, deps())).toBe("skipped-unchanged")
    expect([ollama.chatCalls, ollama.embedCalls]).toEqual([1, 1])
  })

  it("a title change re-embeds, without captioning again", async () => {
    const img = await imageAsset("IMG_0101.jpg", BLUE)
    await indexAssetSemantics(img.id, deps())
    const first = await prisma.assetSemanticIndex.findUniqueOrThrow({ where: { assetId: img.id } })
    await prisma.asset.update({ where: { id: img.id }, data: { title: "Invoice photo" } })
    expect(await indexAssetSemantics(img.id, deps())).toBe("indexed")
    const second = await prisma.assetSemanticIndex.findUniqueOrThrow({ where: { assetId: img.id } })
    expect(second.fingerprint).not.toBe(first.fingerprint)
    expect(ollama.chatCalls).toBe(1)
  })

  it("document insight feeds the index", async () => {
    const doc = await createAsset(fixtures, { librarySlug: "documents", mediaType: "DOCUMENT", originalFilename: "scan_0003.pdf" })
    await prisma.asset.update({ where: { id: doc.id }, data: { documentInsight: { summary: "An invoice for hosting.", keywords: ["billing"] } } })
    expect(await indexAssetSemantics(doc.id, deps())).toBe("indexed")
    expect((await search("payment receipt")).items.map((i) => i.id)).toContain(doc.id)
  })

  it("an asset with nothing meaningful to embed is skipped, not failed", async () => {
    const doc = await createAsset(fixtures, { librarySlug: "documents", mediaType: "DOCUMENT", originalFilename: "scan_0099.pdf" })
    expect(await indexAssetSemantics(doc.id, deps())).toBe("skipped-no-meaning")
    expect((await prisma.assetSemanticIndex.findUniqueOrThrow({ where: { assetId: doc.id } })).status).toBe("SKIPPED")
  })

  it("Ollama down: the row records a code, the job is retried later, and the asset is untouched", async () => {
    const img = await imageAsset("IMG_0102.jpg", RED)
    ollama.online = false
    await expect(indexAssetSemantics(img.id, deps())).rejects.toMatchObject({ code: "OLLAMA_OFFLINE" })
    const row = await prisma.assetSemanticIndex.findUniqueOrThrow({ where: { assetId: img.id } })
    expect(row).toMatchObject({ status: "FAILED", attempts: 1 })
    expect(row.errorCode).toMatch(/^[A-Z_]+$/)
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: img.id } })).status).toBe("READY")
    // Backoff: not picked up again straight away.
    const due = await findAssetsNeedingSemanticIndex(prisma, { model: "nomic-embed-text", digest: "digest-a", indexVersion: 10000, limit: 50 })
    expect(due).not.toContain(img.id)
    ollama.online = true
    await prisma.assetSemanticIndex.update({ where: { assetId: img.id }, data: { updatedAt: new Date(Date.now() - 10 * 60_000) } })
    expect(await findAssetsNeedingSemanticIndex(prisma, { model: "nomic-embed-text", digest: "digest-a", indexVersion: 10000, limit: 50 })).toContain(img.id)
    expect(await indexAssetSemantics(img.id, deps())).toBe("indexed")
  })

  it("disabled: the job does nothing", async () => {
    const img = await imageAsset("IMG_0103.jpg", RED)
    await enable(false)
    expect(await indexAssetSemantics(img.id, deps())).toBe("disabled")
    expect(ollama.embedCalls + ollama.chatCalls).toBe(0)
  })

  it("paused: jobs still in the queue finish without touching Ollama", async () => {
    const img = await imageAsset("IMG_0104.jpg", RED)
    await prisma.semanticSearchConfig.update({ where: { id: "default" }, data: { indexingActive: false } })
    expect(await indexAssetSemantics(img.id, deps())).toBe("paused")
    expect(ollama.embedCalls + ollama.chatCalls).toBe(0)
    expect(await prisma.assetSemanticIndex.findUnique({ where: { assetId: img.id } })).toBeNull()
    await prisma.semanticSearchConfig.update({ where: { id: "default" }, data: { indexingActive: true } })
    expect(await indexAssetSemantics(img.id, deps())).toBe("indexed")
  })

  it("a photo whose own words already say what it is is embedded without a vision caption", async () => {
    const titled = await imageAsset("IMG_0105.jpg", RED)
    await prisma.asset.update({ where: { id: titled.id }, data: { title: "Graduation ceremony" } })
    const named = await imageAsset("lake-house-weekend.jpg", BLUE)
    for (const a of [titled, named]) expect(await indexAssetSemantics(a.id, deps())).toBe("indexed")
    expect(ollama.chatCalls).toBe(0)
    expect(ollama.embedCalls).toBe(2)
    // An opaque camera name still gets its caption.
    const opaque = await imageAsset("DSC_1180.jpg", RED)
    expect(await indexAssetSemantics(opaque.id, deps())).toBe("indexed")
    expect(ollama.chatCalls).toBe(1)
  })

  it("the sweep puts cheap meaning first and photos that need a caption last", async () => {
    const photo = await imageAsset("IMG_0600.jpg", RED)
    const doc = await createAsset(fixtures, { librarySlug: "documents", mediaType: "DOCUMENT", originalFilename: "scan_0600.pdf" })
    await prisma.asset.update({ where: { id: doc.id }, data: { documentInsight: { summary: "A lease agreement." } } })
    const titled = await imageAsset("IMG_0601.jpg", BLUE)
    await prisma.asset.update({ where: { id: titled.id }, data: { title: "Team offsite" } })
    const named = await createAsset(fixtures, { librarySlug: "documents", mediaType: "DOCUMENT", originalFilename: "quarterly-report.pdf" })
    const due = await findAssetsNeedingSemanticIndex(prisma, { model: "nomic-embed-text", digest: "digest-a", indexVersion: 10000, limit: 500 })
    const order = [doc.id, titled.id, named.id, photo.id].map((id) => due.indexOf(id))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it("the backfill sweep finds un-indexed READY assets and nothing deleted or unfinished", async () => {
    const ready = await imageAsset("IMG_0200.jpg", RED)
    const processing = await createAsset(fixtures, { librarySlug: "images", mediaType: "IMAGE", status: "PROCESSING" })
    const gone = await createAsset(fixtures, { librarySlug: "images", mediaType: "IMAGE", deletedAt: new Date() })
    const due = await findAssetsNeedingSemanticIndex(prisma, { model: "nomic-embed-text", digest: "digest-a", indexVersion: 10000, limit: 500 })
    expect(due).toContain(ready.id)
    expect(due).not.toContain(processing.id)
    expect(due).not.toContain(gone.id)
    await indexAssetSemantics(ready.id, deps())
    expect(await findAssetsNeedingSemanticIndex(prisma, { model: "nomic-embed-text", digest: "digest-a", indexVersion: 10000, limit: 500 })).not.toContain(ready.id)
  })

  it("a new model build makes old vectors stale: not compared, and queued for re-embedding", async () => {
    const img = await imageAsset("IMG_0300.jpg", RED)
    await indexAssetSemantics(img.id, deps())
    ollama.digest = "digest-b"
    const { semanticSearchFor } = await import("../../apps/api/src/services/search/hybrid-search")
    semanticSearchFor(prisma).invalidate()
    const stale = await search("birthday party")
    expect(stale.items.map((i) => i.id)).not.toContain(img.id)
    expect(stale.semantic).toBe("not_indexed")
    expect(await findAssetsNeedingSemanticIndex(prisma, { model: "nomic-embed-text", digest: "digest-b", indexVersion: 10000, limit: 50 })).toContain(img.id)
    expect(await indexAssetSemantics(img.id, deps())).toBe("indexed")
    expect((await search("birthday party")).items.map((i) => i.id)).toContain(img.id)
  })

  it("deleting an asset deletes its index row", async () => {
    const img = await imageAsset("IMG_0400.jpg", RED)
    await indexAssetSemantics(img.id, deps())
    await prisma.asset.delete({ where: { id: img.id } })
    expect(await prisma.assetSemanticIndex.findUnique({ where: { assetId: img.id } })).toBeNull()
  })
})

describe("hybrid search keeps the listing's rules", () => {
  it("an exact file name comes first; a file found both ways appears once", async () => {
    const named = await imageAsset("birthday party.jpg", BLUE)
    const img = await imageAsset("IMG_0042.jpg", RED)
    await indexAssetSemantics(img.id, deps())
    await prisma.asset.update({ where: { id: named.id }, data: { title: "Birthday cake" } })
    await indexAssetSemantics(named.id, deps())
    const res = await search("birthday party")
    expect(res.items[0]!.id).toBe(named.id)
    expect(res.items[0]!.searchMatch).toBeUndefined()
    expect(res.items.filter((i) => i.id === named.id)).toHaveLength(1)
    expect(res.items.map((i) => i.id)).toContain(img.id)
  })

  it("soft-deleted and archived files never come back through meaning", async () => {
    const deleted = await imageAsset("IMG_0501.jpg", RED)
    const archived = await imageAsset("IMG_0502.jpg", RED)
    for (const a of [deleted, archived]) await indexAssetSemantics(a.id, deps())
    await prisma.asset.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } })
    await prisma.asset.update({ where: { id: archived.id }, data: { archivedAt: new Date() } })
    const ids = (await search("birthday party")).items.map((i) => i.id)
    expect(ids).not.toContain(deleted.id)
    expect(ids).not.toContain(archived.id)
    expect((await search("birthday party", { archived: "only" })).items.map((i) => i.id)).toContain(archived.id)
  })

  it("folder, library and media-type scopes hold", async () => {
    const folder = await createFolder(fixtures, { librarySlug: "images", name: `Party ${Date.now()}` })
    const inside = await imageAsset("IMG_0601.jpg", RED, { librarySlug: "images", folderId: folder.id })
    const outside = await imageAsset("IMG_0602.jpg", RED)
    for (const a of [inside, outside]) await indexAssetSemantics(a.id, deps())
    const inFolder = (await search("birthday party", { folderId: folder.id })).items.map((i) => i.id)
    expect(inFolder).toContain(inside.id)
    expect(inFolder).not.toContain(outside.id)
    const videos = (await search("birthday party", { libraryId: fixtures.libraries.videos!.id })).items.map((i) => i.id)
    expect(videos).not.toContain(inside.id)
    expect(videos).not.toContain(outside.id)
    const docsOnly = (await search("birthday party", { mediaType: "DOCUMENT" })).items.map((i) => i.id)
    expect(docsOnly).toEqual([])
  })

  it("files in a deleted or hidden folder stay hidden from All Files", async () => {
    const hidden = await createFolder(fixtures, { librarySlug: "images", name: `Hidden ${Date.now()}`, hideFromAllFiles: true })
    const removed = await createFolder(fixtures, { librarySlug: "images", name: `Removed ${Date.now()}`, deletedAt: new Date() })
    const a = await imageAsset("IMG_0701.jpg", RED, { librarySlug: "images", folderId: hidden.id })
    const b = await imageAsset("IMG_0702.jpg", RED, { librarySlug: "images", folderId: removed.id })
    for (const x of [a, b]) await indexAssetSemantics(x.id, deps())
    const ids = (await search("birthday party")).items.map((i) => i.id)
    expect(ids).not.toContain(a.id)
    expect(ids).not.toContain(b.id)
  })

  it("the plain list route (chat, mobile) gets the same matches", async () => {
    const img = await imageAsset("IMG_0801.jpg", RED)
    await indexAssetSemantics(img.id, deps())
    const res = await app.inject({ method: "GET", url: "/api/assets?search=birthday%20party", headers: { cookie: ownerCookie } })
    expect(res.headers["x-arciin-semantic"]).toBe("used")
    expect((res.json().data as Array<{ id: string }>).map((i) => i.id)).toContain(img.id)
  })

  it("with Ollama stopped, keyword search still answers — no error, just name matches", async () => {
    const named = await imageAsset("party-hats.jpg", BLUE)
    const img = await imageAsset("IMG_0901.jpg", RED)
    await indexAssetSemantics(img.id, deps())
    ollama.online = false
    const { semanticSearchFor } = await import("../../apps/api/src/services/search/hybrid-search")
    semanticSearchFor(prisma).invalidate()
    const res = await search("party")
    expect(res.semantic).toBe("unavailable")
    expect(res.items.map((i) => i.id)).toEqual([named.id])
    // Stored vectors are still there for when it comes back.
    expect(await prisma.assetSemanticIndex.count({ where: { status: "INDEXED" } })).toBeGreaterThan(0)
  })

  it("legacy Computer Backup files follow the listing: the owner finds them, another member does not", async () => {
    // Computer Backup is gone as a product, but its files still show in the
    // Images/Videos smart views and All Files for their owner — so they are
    // searchable, by name and by meaning alike, and by nobody else.
    const named = await imageAsset("birthday party backup.jpg", BLUE, { librarySlug: "computers" })
    const img = await imageAsset("IMG_1200.jpg", RED, { librarySlug: "computers" })
    await indexAssetSemantics(img.id, deps())
    const owner = (await search("birthday party")).items.map((i) => i.id)
    expect(owner).toContain(named.id)
    expect(owner).toContain(img.id)
    const member = (await search("birthday party", {}, memberCookie)).items.map((i) => i.id)
    expect(member).not.toContain(named.id)
    expect(member).not.toContain(img.id)
  })

  it("a locked folder: meaning never reaches further than a keyword does", async () => {
    const locked = await createFolder(fixtures, { librarySlug: "images", name: `Locked ${Date.now()}`, lockedAt: new Date() })
    const named = await imageAsset("birthday party locked.jpg", BLUE, { librarySlug: "images", folderId: locked.id })
    const img = await imageAsset("IMG_1300.jpg", RED, { librarySlug: "images", folderId: locked.id })
    await indexAssetSemantics(img.id, deps())
    const all = (await search("birthday party")).items.map((i) => i.id)
    expect(all.includes(img.id)).toBe(all.includes(named.id))
    // Opening the folder itself still needs it unlocked, search or not.
    const qs = new URLSearchParams({ search: "birthday party", folderId: locked.id })
    const res = await app.inject({ method: "GET", url: `/api/assets/page?${qs}`, headers: { cookie: memberCookie } })
    expect(res.statusCode).not.toBe(200)
  })

  it("a semantic query never needs the vision model", async () => {
    const img = await imageAsset("IMG_0950.jpg", RED)
    await indexAssetSemantics(img.id, deps())
    ollama.chatCalls = 0
    await search("birthday party")
    await search("people blowing out candles")
    expect(ollama.chatCalls).toBe(0)
  })
})

describe("owner routes", () => {
  it("status is owner-only and never exposes text or vectors", async () => {
    expect((await app.inject({ method: "GET", url: "/api/semantic-search/status" })).statusCode).toBe(401)
    expect((await app.inject({ method: "GET", url: "/api/semantic-search/status", headers: { cookie: memberCookie } })).statusCode).toBe(403)
    const img = await imageAsset("IMG_1001.jpg", RED)
    await indexAssetSemantics(img.id, deps())
    const res = await app.inject({ method: "GET", url: "/api/semantic-search/status", headers: { cookie: ownerCookie } })
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data).toMatchObject({ enabled: true, provider: "Local Ollama", embeddingModel: "nomic-embed-text", model: { state: "installed", dimension: 768 }, captionModel: "fakevision:latest" })
    expect(data.index.indexed).toBeGreaterThanOrEqual(1)
    expect(res.body).not.toMatch(/birthday|candles|embedding"/)
  })

  it("reports Ollama offline, and a missing model", async () => {
    const img = await imageAsset("IMG_1100.jpg", RED)
    await indexAssetSemantics(img.id, deps())
    ollama.online = false
    let data = (await app.inject({ method: "GET", url: "/api/semantic-search/status", headers: { cookie: ownerCookie } })).json().data
    expect(data.model.state).toBe("ollama_offline")
    // Stored vectors are still counted while the digest cannot be read.
    expect(data.index.indexed).toBeGreaterThanOrEqual(1)
    ollama.online = true
    await prisma.semanticSearchConfig.update({ where: { id: "default" }, data: { embeddingModel: "not-installed-model" } })
    data = (await app.inject({ method: "GET", url: "/api/semantic-search/status", headers: { cookie: ownerCookie } })).json().data
    expect(data.model.state).toBe("missing")
    const start = await app.inject({ method: "POST", url: "/api/semantic-search/index", headers: { cookie: ownerCookie } })
    expect(start.statusCode).toBe(409)
    await prisma.semanticSearchConfig.update({ where: { id: "default" }, data: { embeddingModel: "nomic-embed-text" } })
  })

  it("turning off also stops indexing; starting and pausing are explicit; install needs confirmation", async () => {
    const off = await app.inject({ method: "PATCH", url: "/api/semantic-search/settings", headers: { cookie: ownerCookie }, payload: { enabled: false } })
    expect(off.json().data).toMatchObject({ enabled: false, indexingActive: false })
    const on = await app.inject({ method: "PATCH", url: "/api/semantic-search/settings", headers: { cookie: ownerCookie }, payload: { enabled: true } })
    expect(on.json().data).toMatchObject({ enabled: true, indexingActive: false })
    const start = await app.inject({ method: "POST", url: "/api/semantic-search/index", headers: { cookie: ownerCookie } })
    expect(start.json().data.indexingActive).toBe(true)
    const pause = await app.inject({ method: "POST", url: "/api/semantic-search/pause", headers: { cookie: ownerCookie } })
    expect(pause.json().data.indexingActive).toBe(false)
    const before = (await prisma.semanticSearchConfig.findUniqueOrThrow({ where: { id: "default" } })).rebuildEpoch
    await app.inject({ method: "POST", url: "/api/semantic-search/rebuild", headers: { cookie: ownerCookie } })
    expect((await prisma.semanticSearchConfig.findUniqueOrThrow({ where: { id: "default" } })).rebuildEpoch).toBe(before + 1)
    expect((await app.inject({ method: "POST", url: "/api/semantic-search/model/install", headers: { cookie: ownerCookie }, payload: {} })).statusCode).toBe(400)
    expect((await app.inject({ method: "POST", url: "/api/semantic-search/model/install", headers: { cookie: memberCookie }, payload: { confirm: true } })).statusCode).toBe(403)
  })
})
