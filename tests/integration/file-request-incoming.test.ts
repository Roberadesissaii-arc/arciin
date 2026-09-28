import Redis from "ioredis"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import type { RealtimeEvent } from "@arciin/shared"

import { hashToken } from "../../apps/api/src/services/security/auth"
import {
  createFolder,
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

/**
 * The owner's live view of File Request uploads arriving in a folder.
 *
 * Real Postgres and Redis (db 15), a temporary storage root, 1 MiB chunks.
 * Covers the snapshot endpoint (who may read it, what it carries), the events
 * published over the lifecycle, and that a transfer still receiving bytes is
 * not expired by the session lifetime.
 */

process.env.ARCIIN_UPLOAD_CHUNK_SIZE_MB = "1"
process.env.ARCIIN_UPLOAD_SESSION_HOURS = "24"
const CHUNK = 1024 * 1024
const GIB = 1024 * 1024 * 1024

let fixtures: Fixtures
let root: string
let redis: Redis
let token: string
let fileRequestId: string
let folderId: string
let otherFolderId: string
let ownerCookie: string
let strangerCookie: string
let app: Awaited<ReturnType<typeof buildApp>>
const events: RealtimeEvent[] = []

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerJsonBodyParser } = await import("../../apps/api/src/plugins/json-body")
  const { registerErrorHandler } = await import("../../apps/api/src/plugins/error-handler")
  const { registerFileRequestRoutes } = await import("../../apps/api/src/modules/file-requests/routes")
  const { registerMultipart } = await import("../../apps/api/src/plugins/multipart")
  const { capacityProbe } = await import("../../apps/api/src/modules/file-requests/resumable-routes")
  capacityProbe.read = async () => ({ writable: true, totalBytes: 100 * GIB, availableBytes: 50 * GIB })
  const a = Fastify({ logger: false })
  a.decorate("prisma", prisma)
  a.decorate("redis", redis)
  a.decorate("publishRealtimeEvent", async (event: RealtimeEvent) => {
    events.push(event)
  })
  registerJsonBodyParser(a)
  await registerErrorHandler(a)
  await registerCookies(a)
  await registerMultipart(a)
  await a.register(async (api) => registerFileRequestRoutes(api), { prefix: "/api" })
  await a.ready()
  return a
}

async function sessionCookie(userId: string) {
  const raw = `sess_${crypto.randomUUID()}`
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) },
  })
  return `arciin_session=${raw}`
}

async function createRequest(destination = folderId) {
  const raw = `frq_${crypto.randomUUID().replace(/-/g, "")}`
  const fr = await prisma.fileRequest.create({
    data: {
      instanceId: (await prisma.instanceConfig.findFirstOrThrow()).id,
      createdByUserId: fixtures.user.id,
      destinationLibraryId: fixtures.libraries.documents!.id,
      destinationFolderId: destination,
      title: "Send me the videos",
      tokenHash: hashToken(raw),
      tokenPrefix: raw.slice(0, 12),
      status: "ACTIVE",
      allowAnonymous: true,
    },
  })
  return { raw, id: fr.id }
}

const base = (t = token) => `/api/public/file-requests/${t}/uploads`

async function create(size: number, filename = "movie.bin", t = token) {
  const res = await app.inject({
    method: "POST",
    url: base(t),
    payload: {
      filename,
      sizeBytes: size,
      mimeType: "application/octet-stream",
      lastModified: 1_700_000_000_000,
      submitterName: "Private Person",
      submitterEmail: "private.person@example.invalid",
    },
  })
  expect(res.statusCode, res.body).toBe(201)
  return res.json().data as { uploadId: string; expiresAt: string }
}

async function putChunk(uploadId: string, offset: number, length: number, t = token) {
  return app.inject({
    method: "PUT",
    url: `${base(t)}/${uploadId}/chunks?offset=${offset}`,
    headers: { "content-type": "application/octet-stream" },
    payload: Buffer.alloc(length, offset % 251),
  })
}

async function incoming(cookie = ownerCookie, query = "") {
  const res = await app.inject({ method: "GET", url: `/api/file-requests/incoming${query}`, headers: { cookie } })
  return res
}

beforeAll(async () => {
  root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
  await prisma.instanceConfig.deleteMany()
  await prisma.instanceConfig.create({
    data: { instanceName: "Incoming", storageRoot: root, initializedAt: new Date(), licensePlan: "free", licenseStatus: "none" },
  })
  folderId = (await createFolder(fixtures, { librarySlug: "documents", name: "Requested" })).id
  otherFolderId = (await createFolder(fixtures, { librarySlug: "documents", name: "Elsewhere" })).id
  const stranger = await prisma.user.create({
    data: { email: "stranger@example.invalid", name: "Stranger", passwordHash: "x", role: "ADMIN", status: "ACTIVE" },
  })
  ownerCookie = await sessionCookie(fixtures.user.id)
  strangerCookie = await sessionCookie(stranger.id)
  redis = new Redis(process.env.REDIS_URL!)
  app = await buildApp()
})

afterAll(async () => {
  await app?.close()
  await prisma.resumableUpload.deleteMany()
  await prisma.fileRequestSubmission.deleteMany()
  await prisma.fileRequest.deleteMany()
  await prisma.instanceConfig.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  const keys = await redis.keys("arciin:frq:*")
  if (keys.length) await redis.del(...keys)
  await redis.quit()
  await prisma.$disconnect()
})

beforeEach(async () => {
  events.length = 0
  await prisma.resumableUpload.deleteMany()
  const keys = await redis.keys("arciin:frq:*")
  if (keys.length) await redis.del(...keys)
  const fr = await createRequest()
  token = fr.raw
  fileRequestId = fr.id
})

describe("incoming snapshot", () => {
  it("is empty when nothing is arriving", async () => {
    const res = await incoming()
    expect(res.statusCode).toBe(200)
    expect(res.json().data.folders).toEqual([])
  })

  it("requires a signed-in session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/file-requests/incoming" })
    expect(res.statusCode).toBe(401)
  })

  it("aggregates a folder's uploads by bytes, and counts only what has arrived", async () => {
    const big = await create(4 * CHUNK, "big.bin")
    const small = await create(CHUNK, "small.bin")
    expect((await putChunk(big.uploadId, 0, CHUNK)).statusCode).toBe(200)
    expect((await putChunk(big.uploadId, CHUNK, CHUNK)).statusCode).toBe(200)

    const res = await incoming()
    expect(res.headers["cache-control"]).toBe("no-store")
    const folders = res.json().data.folders
    expect(folders).toHaveLength(1)
    expect(folders[0]).toEqual({
      folderId,
      libraryId: fixtures.libraries.documents!.id,
      activeUploadCount: 2,
      totalBytes: 5 * CHUNK,
      receivedBytes: 2 * CHUNK,
      progressPercent: 40,
      state: "RECEIVING",
    })
    expect(small.uploadId).toBeTruthy()
  })

  it("carries no token, submitter, email or file name", async () => {
    await create(2 * CHUNK)
    const body = (await incoming()).body
    expect(body).not.toContain(token)
    expect(body).not.toContain(token.slice(0, 12))
    expect(body).not.toContain("private.person")
    expect(body).not.toContain("Private Person")
    expect(body).not.toContain("movie.bin")
    expect(Object.keys((await incoming()).json().data.folders[0]).sort()).toEqual(
      ["activeUploadCount", "folderId", "libraryId", "progressPercent", "receivedBytes", "state", "totalBytes"],
    )
  })

  it("shows another user nothing, even an ADMIN", async () => {
    await create(2 * CHUNK)
    const res = await incoming(strangerCookie)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.folders).toEqual([])
  })

  it("filters by folder and library", async () => {
    const elsewhere = await createRequest(otherFolderId)
    await create(CHUNK, "a.bin")
    await create(CHUNK, "b.bin", elsewhere.raw)
    expect((await incoming(ownerCookie)).json().data.folders).toHaveLength(2)
    const one = (await incoming(ownerCookie, `?folderId=${otherFolderId}`)).json().data.folders
    expect(one.map((f: { folderId: string }) => f.folderId)).toEqual([otherFolderId])
    expect((await incoming(ownerCookie, `?libraryId=${fixtures.libraries.videos!.id}`)).json().data.folders).toEqual([])
  })

  it("marks an upload with no recent bytes as waiting", async () => {
    const { uploadId } = await create(2 * CHUNK)
    await prisma.$executeRaw`UPDATE "ResumableUpload" SET "updatedAt" = now() - interval '10 minutes' WHERE id = ${uploadId}`
    expect((await incoming()).json().data.folders[0].state).toBe("WAITING")
  })

  it("drops expired, cancelled, completed and revoked uploads", async () => {
    const expired = await create(CHUNK, "e.bin")
    await prisma.resumableUpload.update({ where: { id: expired.uploadId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const cancelled = await create(CHUNK, "c.bin")
    await app.inject({ method: "DELETE", url: `${base()}/${cancelled.uploadId}` })
    const done = await create(CHUNK, "d.bin")
    await putChunk(done.uploadId, 0, CHUNK)
    const completed = await app.inject({ method: "POST", url: `${base()}/${done.uploadId}/complete`, payload: {} })
    expect(completed.statusCode, completed.body).toBe(200)
    expect((await incoming()).json().data.folders).toEqual([])

    await create(CHUNK, "r.bin")
    expect((await incoming()).json().data.folders).toHaveLength(1)
    const revoke = await app.inject({ method: "POST", url: `/api/file-requests/${fileRequestId}/revoke`, headers: { cookie: ownerCookie } })
    expect(revoke.statusCode).toBe(200)
    expect((await incoming()).json().data.folders).toEqual([])
  })
})

describe("incoming events", () => {
  const incomingEvents = () => events.filter((e) => e.type === "file-request.incoming")
  const phases = () => incomingEvents().map((e) => (e.data as { phase: string }).phase)

  it("announce the lifecycle to the owner alone, with the folder summary", async () => {
    const { uploadId } = await create(2 * CHUNK)
    await putChunk(uploadId, 0, CHUNK)
    await putChunk(uploadId, CHUNK, CHUNK)
    const done = await app.inject({ method: "POST", url: `${base()}/${uploadId}/complete`, payload: {} })
    expect(done.statusCode, done.body).toBe(200)
    // Progress is fire-and-forget; let it land.
    await new Promise((r) => setTimeout(r, 50))

    expect(phases()[0]).toBe("started")
    expect(phases()).toContain("progress")
    expect(phases()).toContain("verifying")
    expect(phases()).toContain("completed")

    for (const event of incomingEvents()) {
      expect(event.userId).toBe(fixtures.user.id)
      expect(event.audience).toBe("user")
      expect(event.libraryId).toBeUndefined()
      const text = JSON.stringify(event)
      expect(text).not.toContain(token)
      expect(text).not.toContain("private.person")
      expect(text).not.toContain("Private Person")
      expect(text).not.toContain("movie.bin")
    }
    const last = incomingEvents().find((e) => (e.data as { phase: string }).phase === "completed")!.data as {
      folder: { activeUploadCount: number; state: string }
    }
    expect(last.folder.activeUploadCount).toBe(0)
    expect(last.folder.state).toBe("IDLE")
  })

  it("throttle progress: many quick chunks do not each publish", async () => {
    const { uploadId } = await create(8 * CHUNK)
    for (let i = 0; i < 7; i++) expect((await putChunk(uploadId, i * CHUNK, CHUNK)).statusCode).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    const progress = phases().filter((p) => p === "progress").length
    expect(progress).toBeGreaterThanOrEqual(1)
    expect(progress).toBeLessThan(7)
    // The final chunk always publishes, so the owner sees 100% before verifying.
    events.length = 0
    expect((await putChunk(uploadId, 7 * CHUNK, CHUNK)).statusCode).toBe(200)
    await new Promise((r) => setTimeout(r, 50))
    const final = incomingEvents().find((e) => (e.data as { phase: string }).phase === "progress")
    expect((final?.data as { folder: { progressPercent: number } }).folder.progressPercent).toBe(100)
  })

  it("announce a cancel as ended", async () => {
    const { uploadId } = await create(2 * CHUNK)
    await app.inject({ method: "DELETE", url: `${base()}/${uploadId}` })
    expect(phases()).toEqual(["started", "ended"])
  })

  it("a duplicate or out-of-order chunk publishes nothing new", async () => {
    const { uploadId } = await create(3 * CHUNK)
    await putChunk(uploadId, 0, CHUNK)
    await new Promise((r) => setTimeout(r, 20))
    events.length = 0
    expect((await putChunk(uploadId, 0, CHUNK)).json().data.duplicate).toBe(true)
    expect((await putChunk(uploadId, 2 * CHUNK, CHUNK)).statusCode).toBe(409)
    await new Promise((r) => setTimeout(r, 20))
    expect(incomingEvents()).toEqual([])
  })
})

describe("session lifetime", () => {
  it("each accepted chunk moves the expiry out; an idle session keeps its own", async () => {
    const { uploadId } = await create(3 * CHUNK)
    // Pretend the transfer has been running for 20 of its 24 hours.
    const soon = new Date(Date.now() + 4 * 60 * 60 * 1000)
    await prisma.resumableUpload.update({
      where: { id: uploadId },
      data: { expiresAt: soon, createdAt: new Date(Date.now() - 20 * 60 * 60 * 1000) },
    })
    expect((await putChunk(uploadId, 0, CHUNK)).statusCode).toBe(200)
    const after = await prisma.resumableUpload.findUniqueOrThrow({ where: { id: uploadId } })
    expect(after.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)

    // A rejected chunk is not progress.
    const before = after.expiresAt.getTime()
    await prisma.resumableUpload.update({ where: { id: uploadId }, data: { expiresAt: soon } })
    expect((await putChunk(uploadId, 2 * CHUNK, CHUNK)).statusCode).toBe(409)
    expect((await prisma.resumableUpload.findUniqueOrThrow({ where: { id: uploadId } })).expiresAt.getTime()).toBe(soon.getTime())
    expect(before).toBeGreaterThan(soon.getTime())
  })

  it("never extends past seven days from the start", async () => {
    const { uploadId } = await create(2 * CHUNK)
    const started = new Date(Date.now() - (7 * 24 - 1) * 60 * 60 * 1000)
    await prisma.resumableUpload.update({ where: { id: uploadId }, data: { createdAt: started, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } })
    expect((await putChunk(uploadId, 0, CHUNK)).statusCode).toBe(200)
    const after = await prisma.resumableUpload.findUniqueOrThrow({ where: { id: uploadId } })
    expect(after.expiresAt.getTime()).toBeLessThanOrEqual(started.getTime() + 7 * 24 * 60 * 60 * 1000)
    expect(after.expiresAt.getTime()).toBeGreaterThan(Date.now() + 30 * 60 * 1000 - 5000)
  })

  it("an expired session is still refused, and announced as ended", async () => {
    const { uploadId } = await create(2 * CHUNK)
    await prisma.resumableUpload.update({ where: { id: uploadId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const res = await putChunk(uploadId, 0, CHUNK)
    expect(res.statusCode).toBe(410)
    expect(res.json().error.code).toBe("UPLOAD_SESSION_EXPIRED")
    expect(events.filter((e) => e.type === "file-request.incoming").map((e) => (e.data as { phase: string }).phase)).toContain("ended")
  })
})
