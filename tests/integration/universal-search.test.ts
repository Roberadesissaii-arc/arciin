import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import Redis from "ioredis"
import sharp from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { hashToken } from "../../apps/api/src/services/security/auth"
import { indexAssetSemantics } from "../../apps/worker/src/services/semantic-index"
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
 * The top search box against real PostgreSQL: keyword files, folders and
 * libraries from GET /search, and the hybrid file list from
 * GET /search/files — with the same visibility rules as All Files, plus no
 * locked-folder contents and no legacy Computer Backup folder trees.
 *
 * Ollama is the same deterministic fake as the semantic-search suite.
 */

const CONCEPTS: Record<string, string[]> = {
  celebration: ["birthday", "party", "cake", "candles", "celebration"],
  beach: ["beach", "sunset", "ocean", "waves"],
}
const conceptVector = (index: number) => Array.from({ length: 768 }, (_, i) => Math.sin((i + 1) * (index + 1) * 1.37))
function fakeEmbedding(text: string): number[] {
  const words = text.toLowerCase().replace(/^search_(query|document): /, "").split(/[^a-z]+/)
  const out = new Array(768).fill(0)
  Object.values(CONCEPTS).forEach((list, index) => {
    if (words.some((w) => list.includes(w))) conceptVector(index).forEach((v, i) => (out[i] += v))
  })
  if (out.every((v) => v === 0)) out[767] = 1
  return out
}

const ollama = { online: true }

async function fakeFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  const href = String(url)
  if (!href.startsWith("http://127.0.0.1:11434")) throw new Error(`unexpected request to ${href}`)
  if (!ollama.online) throw new TypeError("fetch failed")
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  if (href.endsWith("/api/tags")) {
    return Response.json({
      models: [
        { name: "nomic-embed-text:latest", digest: "digest-a", size: 274_302_450 },
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
  if (href.endsWith("/api/embed")) return Response.json({ embeddings: (body.input as string[]).map(fakeEmbedding) })
  if (href.endsWith("/api/chat")) {
    const image = Buffer.from(body.messages[0].images[0], "base64")
    const { dominant } = await sharp(image).stats()
    return Response.json({
      message: { content: dominant.r > dominant.b ? "A birthday party with a cake and candles." : "Waves on a beach at sunset." },
    })
  }
  return new Response("not found", { status: 404 })
}

let fixtures: Fixtures
let root: string
let redis: Redis
let app: Awaited<ReturnType<typeof buildApp>>
let ownerCookie: string
let memberCookie: string
let memberId: string

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerJsonBodyParser } = await import("../../apps/api/src/plugins/json-body")
  const { registerErrorHandler } = await import("../../apps/api/src/plugins/error-handler")
  const { registerUniversalSearchRoutes } = await import("../../apps/api/src/modules/search/routes")
  const a = Fastify({ logger: false })
  a.decorate("prisma", prisma)
  a.decorate("redis", redis)
  a.decorate("publishRealtimeEvent", async () => {})
  registerJsonBodyParser(a)
  await registerErrorHandler(a)
  await registerCookies(a)
  await a.register(async (api) => registerUniversalSearchRoutes(api), { prefix: "/api" })
  await a.ready()
  return a
}

async function cookieFor(userId: string) {
  const raw = `sess_${crypto.randomUUID()}`
  await prisma.session.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) } })
  return `arciin_session=${raw}`
}

type FileResult = {
  id: string
  originalFilename: string
  library: { name: string; slug: string } | null
  folder: { name: string } | null
  match: { kind: string; label: string | null }
}
type Quick = {
  files: FileResult[]
  folders: Array<{ id: string; name: string; path: string; isLocked: boolean; library: { slug: string } }>
  libraries: Array<{ slug: string }>
}
type Hybrid = { files: FileResult[]; semantic: string; index: { indexed: number; eligible: number } | null }

async function get<T>(url: string, cookie = ownerCookie): Promise<T> {
  const res = await app.inject({ method: "GET", url, headers: { cookie } })
  expect(res.statusCode, res.body).toBe(200)
  return res.json().data as T
}
const quick = (q: string, cookie?: string) => get<Quick>(`/api/search?q=${encodeURIComponent(q)}`, cookie)
const hybrid = (q: string, cookie?: string) => get<Hybrid>(`/api/search/files?q=${encodeURIComponent(q)}`, cookie)

async function enable(on = true, indexingActive = on) {
  await prisma.semanticSearchConfig.upsert({
    where: { id: "default" },
    create: { id: "default", enabled: on, indexingActive },
    update: { enabled: on, indexingActive },
  })
  const { semanticSearchFor } = await import("../../apps/api/src/services/search/hybrid-search")
  semanticSearchFor(prisma).invalidate()
}

async function imageAsset(name: string, color: { r: number; g: number; b: number }) {
  const asset = await createAsset(fixtures, { librarySlug: "images", mediaType: "IMAGE", mimeType: "image/jpeg", extension: "jpg", originalFilename: name })
  const so = await prisma.storageObject.findUniqueOrThrow({ where: { id: asset.storageObjectId } })
  await mkdir(path.dirname(so.physicalPath), { recursive: true })
  await writeFile(so.physicalPath, await sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).jpeg().toBuffer())
  return asset
}
const deps = () => ({ prisma, storageRoot: root, baseUrl: "http://127.0.0.1:11434", fetchImpl: fakeFetch as never })

beforeAll(async () => {
  vi.stubGlobal("fetch", fakeFetch)
  root = await createTestStorageRoot()
  await resetDatabase()
  await prisma.assetSemanticIndex.deleteMany()
  await prisma.semanticSearchConfig.deleteMany()
  fixtures = await seedBaseFixtures(root)
  await prisma.instanceConfig.deleteMany()
  await prisma.instanceConfig.create({ data: { instanceName: "Search", storageRoot: root, initializedAt: new Date(), licensePlan: "free", licenseStatus: "none" } })
  const member = await prisma.user.create({ data: { email: "member@example.invalid", name: "Member", passwordHash: "x", role: "MEMBER", status: "ACTIVE" } })
  memberId = member.id
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
  await prisma.assetSemanticIndex.deleteMany()
  await prisma.asset.updateMany({ data: { deletedAt: new Date() } })
  await prisma.folder.updateMany({ data: { deletedAt: new Date() } })
  await enable(false)
})

describe("GET /search", () => {
  it("requires a session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/search?q=x" })
    expect(res.statusCode).toBe(401)
  })

  it("an empty query returns nothing and does no work", async () => {
    expect(await quick("   ")).toEqual({ query: "", files: [], folders: [], libraries: [] })
  })

  it("ranks files exact → prefix → contains, bounded to 8", async () => {
    await createAsset(fixtures, { librarySlug: "documents", originalFilename: "quarterly report.pdf", mediaType: "DOCUMENT" })
    await createAsset(fixtures, { librarySlug: "documents", originalFilename: "report 2026.pdf", mediaType: "DOCUMENT" })
    await createAsset(fixtures, { librarySlug: "documents", originalFilename: "report.pdf", mediaType: "DOCUMENT" })
    for (let i = 0; i < 12; i++) await createAsset(fixtures, { librarySlug: "documents", originalFilename: `old-report-${i}.pdf`, mediaType: "DOCUMENT" })
    const { files } = await quick("report")
    expect(files).toHaveLength(8)
    expect(files[0]!.originalFilename).toBe("report.pdf")
    expect(files[0]!.match.kind).toBe("exact")
    expect(files[1]!.originalFilename).toBe("report 2026.pdf")
    expect(files.every((f) => f.match.label === null)).toBe(true)
    expect(files[0]!.library).toMatchObject({ name: "Documents", slug: "documents" })
  })

  it("treats % and _ literally", async () => {
    await createAsset(fixtures, { librarySlug: "documents", originalFilename: "plain.pdf", mediaType: "DOCUMENT" })
    expect((await quick("%")).files).toEqual([])
    expect((await quick("_")).files).toEqual([])
  })

  it("never returns deleted, archived, hidden-folder or locked-folder files", async () => {
    const hidden = await createFolder(fixtures, { librarySlug: "images", name: "Secret Album", hideFromAllFiles: true })
    const locked = await createFolder(fixtures, { librarySlug: "images", name: "Vault", lockedAt: new Date() })
    const lockedChild = await createFolder(fixtures, { librarySlug: "images", name: "Inner", parentFolderId: locked.id, lockedAt: null })
    const gone = await createFolder(fixtures, { librarySlug: "images", name: "Gone", deletedAt: new Date() })
    await createAsset(fixtures, { librarySlug: "images", originalFilename: "sunset visible.jpg", mediaType: "IMAGE" })
    await createAsset(fixtures, { librarySlug: "images", originalFilename: "sunset deleted.jpg", mediaType: "IMAGE", deletedAt: new Date() })
    const archived = await createAsset(fixtures, { librarySlug: "images", originalFilename: "sunset archived.jpg", mediaType: "IMAGE" })
    await prisma.asset.update({ where: { id: archived.id }, data: { archivedAt: new Date() } })
    await createAsset(fixtures, { librarySlug: "images", folderId: hidden.id, originalFilename: "sunset hidden.jpg", mediaType: "IMAGE" })
    await createAsset(fixtures, { librarySlug: "images", folderId: locked.id, originalFilename: "sunset locked.jpg", mediaType: "IMAGE" })
    await createAsset(fixtures, { librarySlug: "images", folderId: lockedChild.id, originalFilename: "sunset nested in locked.jpg", mediaType: "IMAGE" })
    await createAsset(fixtures, { librarySlug: "images", folderId: gone.id, originalFilename: "sunset in deleted folder.jpg", mediaType: "IMAGE" })

    for (const run of [quick, hybrid]) {
      const names = (await run("sunset")).files.map((f) => f.originalFilename)
      expect(names).toEqual(["sunset visible.jpg"])
    }
  })

  it("finds folders by name and path, ranks them, and skips hidden, deleted and Computer Backup folders", async () => {
    const wedding = await createFolder(fixtures, { librarySlug: "videos", name: "Wedding" })
    await createFolder(fixtures, { librarySlug: "videos", name: "Highlights", parentFolderId: wedding.id })
    await createFolder(fixtures, { librarySlug: "images", name: "Wedding photos" })
    await createFolder(fixtures, { librarySlug: "images", name: "Wedding hidden", hideFromAllFiles: true })
    await createFolder(fixtures, { librarySlug: "images", name: "Wedding deleted", deletedAt: new Date() })
    await createFolder(fixtures, { librarySlug: "computers", name: "Wedding backup" })
    await createFolder(fixtures, { librarySlug: "images", name: "Wedding vault", lockedAt: new Date() })

    const { folders } = await quick("wedding")
    expect(folders.map((f) => f.name)).toEqual(["Wedding", "Wedding photos", "Wedding vault", "Highlights"])
    expect(folders.find((f) => f.name === "Wedding vault")!.isLocked).toBe(true)
    expect(folders[0]!.path).toBe("/wedding")
    expect(folders.some((f) => f.library.slug === "computers")).toBe(false)
  })

  it("returns libraries but never the Computers library", async () => {
    expect((await quick("ima")).libraries.map((l) => l.slug)).toEqual(["images"])
    expect((await quick("comp")).libraries).toEqual([])
  })

  it("computer-backup files show under their media library without the backup path, and only to their owner or an admin", async () => {
    const device = await createFolder(fixtures, { librarySlug: "computers", name: "LAPTOP-01" })
    const backup = await createAsset(fixtures, { librarySlug: "computers", folderId: device.id, originalFilename: "graduation.jpg", mediaType: "IMAGE" })
    const ownerView = (await quick("graduation")).files
    expect(ownerView.map((f) => f.id)).toEqual([backup.id])
    expect(ownerView[0]!.library).toMatchObject({ slug: "images", name: "Images" })
    expect(ownerView[0]!.folder).toBeNull()
    expect(JSON.stringify(ownerView)).not.toContain("LAPTOP-01")

    // A member does not see another user's backup.
    expect((await quick("graduation", memberCookie)).files).toEqual([])
    await prisma.asset.update({ where: { id: backup.id }, data: { ownerId: memberId } })
    expect((await quick("graduation", memberCookie)).files.map((f) => f.id)).toEqual([backup.id])
  })
})

describe("GET /search/files — matches by meaning", () => {
  it("semantic disabled: keyword results only, status 'disabled', no index line", async () => {
    await createAsset(fixtures, { librarySlug: "documents", originalFilename: "party invite.pdf", mediaType: "DOCUMENT" })
    const res = await hybrid("party")
    expect(res.semantic).toBe("disabled")
    expect(res.index).toBeNull()
    expect(res.files.map((f) => f.originalFilename)).toEqual(["party invite.pdf"])
  })

  it("finds a file by meaning after keyword hits, labelled, with no score", async () => {
    await enable(true)
    const img = await imageAsset("IMG_0042.jpg", { r: 220, g: 30, b: 30 })
    await createAsset(fixtures, { librarySlug: "documents", originalFilename: "party invite.pdf", mediaType: "DOCUMENT" })
    expect(await indexAssetSemantics(img.id, deps())).toBe("indexed")

    const res = await hybrid("birthday party")
    expect(res.semantic).toBe("used")
    const hit = res.files.find((f) => f.id === img.id)
    expect(hit?.match).toEqual({ kind: "semantic", label: "Matched by meaning" })
    expect(JSON.stringify(res)).not.toMatch(/"score"|cosine/)

    const both = await hybrid("party")
    expect(both.files[0]!.originalFilename).toBe("party invite.pdf")
    expect(both.files[0]!.match.kind).not.toBe("semantic")
  })

  it("Ollama offline: still answers with name matches and says 'unavailable'", async () => {
    await enable(true)
    await createAsset(fixtures, { librarySlug: "documents", originalFilename: "party plan.pdf", mediaType: "DOCUMENT" })
    ollama.online = false
    const res = await hybrid("party")
    expect(res.semantic).toBe("unavailable")
    expect(res.files.map((f) => f.originalFilename)).toEqual(["party plan.pdf"])
  })

  it("nothing indexed yet: 'not_indexed', with name matches", async () => {
    await enable(true)
    await createAsset(fixtures, { librarySlug: "documents", originalFilename: "beach notes.pdf", mediaType: "DOCUMENT" })
    const res = await hybrid("beach")
    expect(res.semantic).toBe("not_indexed")
    expect(res.files.map((f) => f.originalFilename)).toEqual(["beach notes.pdf"])
  })

  it("partially indexed: reports progress while indexing is active", async () => {
    await enable(true)
    const a = await imageAsset("IMG_1.jpg", { r: 220, g: 30, b: 30 })
    await imageAsset("IMG_2.jpg", { r: 20, g: 40, b: 230 })
    await indexAssetSemantics(a.id, deps())
    const res = await hybrid("cake")
    expect(res.semantic).toBe("used")
    expect(res.index).toEqual({ indexed: 1, eligible: 2 })
  })

  it("a meaning match never surfaces a file the keyword listing would hide", async () => {
    await enable(true)
    const locked = await createFolder(fixtures, { librarySlug: "images", name: "Private", lockedAt: new Date() })
    const img = await imageAsset("IMG_0099.jpg", { r: 220, g: 30, b: 30 })
    await indexAssetSemantics(img.id, deps())
    await prisma.asset.update({ where: { id: img.id }, data: { folderId: locked.id } })
    const res = await hybrid("birthday party")
    expect(res.files.map((f) => f.id)).not.toContain(img.id)
  })
})
