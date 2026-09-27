import { createHash } from "node:crypto"
import { existsSync, statSync } from "node:fs"
import { open, readdir, stat, truncate, utimes } from "node:fs/promises"
import path from "node:path"

import Redis from "ioredis"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

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
 * Resumable File Request uploads, end to end at the API.
 *
 * Real Postgres, real Redis (db 15), a temporary storage root. Chunks are
 * 1 MiB here (ARCIIN_UPLOAD_CHUNK_SIZE_MB=1) so the suite stays quick; the
 * protocol is identical at the 16 MiB default.
 *
 * The 1 GB and 2 GB cases are *logical*: the partial is extended as a sparse
 * file to just before its end and the last chunks are sent for real, so
 * offsets past 2^31, final assembly, streaming SHA-256 and commit are all
 * exercised without writing gigabytes to this host's disk.
 */

process.env.ARCIIN_UPLOAD_CHUNK_SIZE_MB = "1"
const CHUNK = 1024 * 1024
const GIB = 1024 * 1024 * 1024

let fixtures: Fixtures
let root: string
let redis: Redis
let token: string
let fileRequestId: string
let folderId: string
let app: Awaited<ReturnType<typeof buildApp>>
let capacity: { read: (storageRoot: string) => Promise<{ writable: boolean; totalBytes: number | null; availableBytes: number | null }> }
let realRead: typeof capacity.read

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerJsonBodyParser } = await import("../../apps/api/src/plugins/json-body")
  const { registerErrorHandler } = await import("../../apps/api/src/plugins/error-handler")
  const { registerFileRequestRoutes } = await import("../../apps/api/src/modules/file-requests/routes")
  const { registerMultipart } = await import("../../apps/api/src/plugins/multipart")
  const a = Fastify({ logger: false })
  a.decorate("prisma", prisma)
  a.decorate("redis", redis)
  a.decorate("publishRealtimeEvent", async () => {})
  registerJsonBodyParser(a)
  await registerErrorHandler(a)
  await registerCookies(a)
  await registerMultipart(a)
  await a.register(async (api) => registerFileRequestRoutes(api), { prefix: "/api" })
  await a.ready()
  return a
}

/** Deterministic content: byte i of file `seed` — so any corruption changes the hash. */
function bytesAt(seed: number, start: number, length: number): Buffer {
  const out = Buffer.allocUnsafe(length)
  for (let i = 0; i < length; i++) out[i] = (start + i + seed * 7) % 251
  return out
}

function sha256OfSource(seed: number, size: number): string {
  const hash = createHash("sha256")
  for (let off = 0; off < size; off += CHUNK) hash.update(bytesAt(seed, off, Math.min(CHUNK, size - off)))
  return hash.digest("hex")
}

async function createRequest(overrides: Record<string, unknown> = {}) {
  const raw = `frq_${crypto.randomUUID().replace(/-/g, "")}`
  const fr = await prisma.fileRequest.create({
    data: {
      instanceId: (await prisma.instanceConfig.findFirstOrThrow()).id,
      createdByUserId: fixtures.user.id,
      destinationLibraryId: fixtures.libraries.documents!.id,
      destinationFolderId: folderId,
      title: "Send me the videos",
      tokenHash: hashToken(raw),
      tokenPrefix: raw.slice(0, 12),
      status: "ACTIVE",
      allowAnonymous: true,
      ...overrides,
    },
  })
  return { raw, id: fr.id }
}

const base = (t = token) => `/api/public/file-requests/${t}/uploads`

async function create(meta: { filename: string; sizeBytes: number; lastModified?: number }, t = token, extra: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url: base(t), payload: { mimeType: "application/octet-stream", lastModified: 1_700_000_000_000, ...meta, ...extra } })
}

async function putChunk(uploadId: string, offset: number, body: Buffer, t = token, headers: Record<string, string> = {}) {
  return app.inject({
    method: "PUT",
    url: `${base(t)}/${uploadId}/chunks?offset=${offset}`,
    headers: { "content-type": "application/octet-stream", ...headers },
    payload: body,
  })
}

async function sendRange(uploadId: string, seed: number, size: number, from: number, to: number) {
  for (let off = from; off < to; off += CHUNK) {
    const res = await putChunk(uploadId, off, bytesAt(seed, off, Math.min(CHUNK, size - off)))
    expect(res.statusCode, res.body).toBe(200)
  }
}

async function complete(uploadId: string, t = token, payload: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url: `${base(t)}/${uploadId}/complete`, payload })
}

async function status(uploadId: string, t = token) {
  return app.inject({ method: "GET", url: `${base(t)}/${uploadId}` })
}

function partialFile(uploadId: string) {
  return path.join(root, "temp", "resumable", `${uploadId}.partial`)
}

async function assetFor(uploadId: string) {
  const session = await prisma.resumableUpload.findUniqueOrThrow({ where: { id: uploadId } })
  expect(session.assetId).toBeTruthy()
  return prisma.asset.findUniqueOrThrow({ where: { id: session.assetId! }, include: { storageObject: true } })
}

beforeAll(async () => {
  root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
  await prisma.instanceConfig.deleteMany()
  await prisma.instanceConfig.create({
    data: { instanceName: "Resumable", storageRoot: root, initializedAt: new Date(), licensePlan: "free", licenseStatus: "none" },
  })
  folderId = (await createFolder(fixtures, { librarySlug: "documents", name: "Requested" })).id
  redis = new Redis(process.env.REDIS_URL!)
  const mod = await import("../../apps/api/src/modules/file-requests/resumable-routes")
  capacity = mod.capacityProbe
  realRead = capacity.read
  app = await buildApp()
})

afterAll(async () => {
  capacity.read = realRead
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
  capacity.read = async () => ({ writable: true, totalBytes: 100 * GIB, availableBytes: 50 * GIB })
  const keys = await redis.keys("arciin:frq:*")
  if (keys.length) await redis.del(...keys)
  const fr = await createRequest()
  token = fr.raw
  fileRequestId = fr.id
})

async function uploadWhole(seed: number, size: number, filename = `file-${seed}.bin`) {
  const created = await create({ filename, sizeBytes: size })
  expect(created.statusCode, created.body).toBe(201)
  const { uploadId, chunkSize } = created.json().data
  expect(chunkSize).toBe(CHUNK)
  await sendRange(uploadId, seed, size, 0, size)
  const done = await complete(uploadId)
  expect(done.statusCode, done.body).toBe(200)
  return { uploadId, done: done.json().data }
}

describe("sizes", () => {
  it.each([
    ["1 KB", 1024],
    ["5 MB", 5 * 1024 * 1024],
    ["32 MB", 32 * 1024 * 1024],
    ["an odd size that is not a chunk multiple", 3 * CHUNK + 12345],
  ])("%s arrives intact, in the request's folder", async (_label, size) => {
    const seed = size % 97
    const { uploadId, done } = await uploadWhole(seed, size)
    expect(done.status).toBe("COMPLETE")
    const asset = await assetFor(uploadId)
    expect(asset.folderId).toBe(folderId)
    expect(asset.fileRequestId).toBe(fileRequestId)
    expect(Number(asset.sizeBytes)).toBe(size)
    expect(asset.checksumSha256).toBe(sha256OfSource(seed, size))
    expect(statSync(asset.storageObject.physicalPath).size).toBe(size)
    // No asset points at a partial, and the partial is gone.
    expect(asset.storageObject.physicalPath).not.toContain(".partial")
    expect(existsSync(partialFile(uploadId))).toBe(false)
  })

  it.each([
    ["100 MB", 100 * 1024 * 1024],
    ["1 GB", GIB],
    ["2 GB", 2 * GIB],
  ])("%s logical upload: large offsets, assembly, hash and commit", async (_label, size) => {
    const created = await create({ filename: `big-${size}.bin`, sizeBytes: size })
    expect(created.statusCode, created.body).toBe(201)
    const { uploadId } = created.json().data
    // Stand-in for everything before the last 3 chunks: a sparse run of zero
    // bytes, recorded as received. The last 3 chunks go over HTTP for real.
    const tailStart = size - 3 * CHUNK
    await truncate(partialFile(uploadId), tailStart)
    await prisma.resumableUpload.update({ where: { id: uploadId }, data: { receivedBytes: BigInt(tailStart) } })
    expect((await status(uploadId)).json().data.uploadedBytes).toBe(tailStart)

    for (let off = tailStart; off < size; off += CHUNK) {
      const res = await putChunk(uploadId, off, bytesAt(9, off, CHUNK))
      expect(res.statusCode, res.body).toBe(200)
      expect(res.json().data.uploadedBytes).toBe(off + CHUNK)
    }

    const expectedHash = createHash("sha256")
    const zeros = Buffer.alloc(8 * CHUNK)
    for (let off = 0; off < tailStart; off += zeros.length) expectedHash.update(zeros.subarray(0, Math.min(zeros.length, tailStart - off)))
    for (let off = tailStart; off < size; off += CHUNK) expectedHash.update(bytesAt(9, off, CHUNK))

    const done = await complete(uploadId)
    expect(done.statusCode, done.body).toBe(200)
    expect(done.json().data.checksumSha256).toBe(expectedHash.digest("hex"))
    const asset = await assetFor(uploadId)
    expect(Number(asset.sizeBytes)).toBe(size)
    expect((await stat(asset.storageObject.physicalPath)).size).toBe(size)
  }, 120_000)
})

describe("interruption and resume", () => {
  it.each([["20%", 0.2], ["70%", 0.7]])("a connection lost at %s resumes from the server's offset, not zero", async (_label, fraction) => {
    const size = 20 * CHUNK + 777
    const created = await create({ filename: "movie.mp4", sizeBytes: size })
    const { uploadId } = created.json().data
    const dropAt = Math.floor((size * fraction) / CHUNK) * CHUNK
    await sendRange(uploadId, 3, size, 0, dropAt)

    // "Connection lost": the client asks where to continue.
    const st = (await status(uploadId)).json().data
    expect(st.uploadedBytes).toBe(dropAt)
    expect(st.status).toBe("UPLOADING")
    // Half a file is never a file: no asset, and the partial lives only under
    // the hidden temp/resumable directory, not in objects/ or libraries/.
    expect(await prisma.asset.count({ where: { fileRequestId } })).toBe(0)
    expect(existsSync(partialFile(uploadId))).toBe(true)

    await sendRange(uploadId, 3, size, st.uploadedBytes, size)
    const done = await complete(uploadId)
    expect(done.statusCode).toBe(200)
    expect((await assetFor(uploadId)).checksumSha256).toBe(sha256OfSource(3, size))
  })

  it("a page refresh re-selecting the same file continues the same session", async () => {
    const size = 6 * CHUNK
    const first = (await create({ filename: "holiday.mov", sizeBytes: size, lastModified: 123 })).json().data
    await sendRange(first.uploadId, 4, size, 0, 2 * CHUNK)
    const again = await create({ filename: "holiday.mov", sizeBytes: size, lastModified: 123 })
    expect(again.statusCode).toBe(200)
    expect(again.json().data.uploadId).toBe(first.uploadId)
    expect(again.json().data.uploadedBytes).toBe(2 * CHUNK)
    expect(again.json().data.resumed).toBe(true)
  })

  it("an API restart loses nothing: a fresh server continues the session from Postgres", async () => {
    const size = 5 * CHUNK
    const { uploadId } = (await create({ filename: "restart.bin", sizeBytes: size })).json().data
    await sendRange(uploadId, 5, size, 0, 2 * CHUNK)
    await app.close()
    app = await buildApp() // new process state, same database and disk
    expect((await status(uploadId)).json().data.uploadedBytes).toBe(2 * CHUNK)
    await sendRange(uploadId, 5, size, 2 * CHUNK, size)
    expect((await complete(uploadId)).statusCode).toBe(200)
    expect((await assetFor(uploadId)).checksumSha256).toBe(sha256OfSource(5, size))
  })
})

describe("chunk rules", () => {
  it("retrying a chunk whose response was lost does not append it twice", async () => {
    const size = 4 * CHUNK
    const { uploadId } = (await create({ filename: "dup.bin", sizeBytes: size })).json().data
    await sendRange(uploadId, 6, size, 0, 2 * CHUNK)
    const retry = await putChunk(uploadId, CHUNK, bytesAt(6, CHUNK, CHUNK))
    expect(retry.statusCode).toBe(200)
    expect(retry.json().data).toMatchObject({ uploadedBytes: 2 * CHUNK, duplicate: true })
    await sendRange(uploadId, 6, size, 2 * CHUNK, size)
    await complete(uploadId)
    const asset = await assetFor(uploadId)
    expect(Number(asset.sizeBytes)).toBe(size)
    expect(asset.checksumSha256).toBe(sha256OfSource(6, size))
  })

  it("a gap, an off-grid offset, or a negative offset is refused with where to resume", async () => {
    const size = 4 * CHUNK
    const { uploadId } = (await create({ filename: "gap.bin", sizeBytes: size })).json().data
    await sendRange(uploadId, 7, size, 0, CHUNK)
    for (const offset of [3 * CHUNK, CHUNK + 1, -1]) {
      const res = await app.inject({
        method: "PUT",
        url: `${base()}/${uploadId}/chunks?offset=${offset}`,
        headers: { "content-type": "application/octet-stream" },
        payload: bytesAt(7, 0, CHUNK),
      })
      expect(res.statusCode).toBe(409)
      expect(res.json().error.code).toBe("INVALID_UPLOAD_OFFSET")
      expect(res.json().error.details.expectedOffset).toBe(CHUNK)
    }
  })

  it("a chunk of the wrong length is refused and not counted", async () => {
    const { uploadId } = (await create({ filename: "len.bin", sizeBytes: 3 * CHUNK })).json().data
    const res = await putChunk(uploadId, 0, bytesAt(1, 0, CHUNK - 10))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("INVALID_CHUNK_SIZE")
    expect((await status(uploadId)).json().data.uploadedBytes).toBe(0)
  })

  it("a chunk damaged in transit (per-chunk SHA-256) is refused and resent", async () => {
    const { uploadId } = (await create({ filename: "sum.bin", sizeBytes: 2 * CHUNK })).json().data
    const bad = await putChunk(uploadId, 0, bytesAt(2, 0, CHUNK), token, { "x-chunk-sha256": "0".repeat(64) })
    expect(bad.statusCode).toBe(422)
    expect(bad.json().error.code).toBe("CHUNK_CHECKSUM_MISMATCH")
    expect((await status(uploadId)).json().data.uploadedBytes).toBe(0)
    const good = createHash("sha256").update(bytesAt(2, 0, CHUNK)).digest("hex")
    expect((await putChunk(uploadId, 0, bytesAt(2, 0, CHUNK), token, { "x-chunk-sha256": good })).statusCode).toBe(200)
  })

  it("complete before every chunk arrives is UPLOAD_INCOMPLETE", async () => {
    const { uploadId } = (await create({ filename: "early.bin", sizeBytes: 3 * CHUNK })).json().data
    await sendRange(uploadId, 8, 3 * CHUNK, 0, CHUNK)
    const res = await complete(uploadId)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("UPLOAD_INCOMPLETE")
  })

  it("a client checksum that does not match the assembled file fails the upload", async () => {
    const size = 2 * CHUNK
    const { uploadId } = (await create({ filename: "wrong.bin", sizeBytes: size })).json().data
    await sendRange(uploadId, 10, size, 0, size)
    const res = await complete(uploadId, token, { sha256: "f".repeat(64) })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe("CHECKSUM_MISMATCH")
    expect(await prisma.asset.count({ where: { fileRequestId, originalFilename: "wrong.bin" } })).toBe(0)
  })

  it("completing twice is safe", async () => {
    const { uploadId } = await uploadWhole(11, CHUNK)
    const again = await complete(uploadId)
    expect(again.statusCode).toBe(200)
    expect(await prisma.asset.count({ where: { fileRequestId } })).toBe(1)
  })
})

describe("request link binding and lifetime", () => {
  it("an upload id is useless with another request's token", async () => {
    const { uploadId } = (await create({ filename: "mine.bin", sizeBytes: CHUNK })).json().data
    const other = await createRequest()
    for (const res of [
      await status(uploadId, other.raw),
      await putChunk(uploadId, 0, bytesAt(1, 0, CHUNK), other.raw),
      await complete(uploadId, other.raw),
    ]) {
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe("UPLOAD_NOT_FOUND")
    }
  })

  it("the client cannot choose the destination", async () => {
    const elsewhere = await createFolder(fixtures, { librarySlug: "videos", name: "Not yours" })
    const created = await create({ filename: "sneaky.bin", sizeBytes: CHUNK }, token, {
      folderId: elsewhere.id,
      libraryId: fixtures.libraries.videos!.id,
      ownerId: "someone-else",
      storagePath: "/etc",
    })
    const { uploadId } = created.json().data
    await sendRange(uploadId, 12, CHUNK, 0, CHUNK)
    await complete(uploadId)
    const asset = await assetFor(uploadId)
    expect(asset.folderId).toBe(folderId)
    expect(asset.libraryId).toBe(fixtures.libraries.documents!.id)
  })

  it("path tricks in the filename never reach the file system", async () => {
    const created = await create({ filename: "../../../etc/passwd", sizeBytes: CHUNK })
    if (created.statusCode === 201) {
      const { uploadId, fileName } = created.json().data
      expect(fileName).not.toContain("..")
      expect(fileName).not.toContain("/")
      await sendRange(uploadId, 13, CHUNK, 0, CHUNK)
      await complete(uploadId)
      const asset = await assetFor(uploadId)
      expect(asset.storageObject.physicalPath.startsWith(root)).toBe(true)
    } else {
      expect(created.json().error.code).toBe("INVALID_FILENAME")
    }
    expect((await create({ filename: "a\u0000b.txt", sizeBytes: 10 })).statusCode).not.toBe(500)
  })

  it("an expired request accepts no new uploads", async () => {
    await prisma.fileRequest.update({ where: { id: fileRequestId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const res = await create({ filename: "late.bin", sizeBytes: CHUNK })
    expect(res.statusCode).toBe(410)
    expect(res.json().error.code).toBe("REQUEST_EXPIRED")
  })

  it("a transfer started before the request expired may finish", async () => {
    const size = 3 * CHUNK
    const { uploadId } = (await create({ filename: "in-flight.bin", sizeBytes: size })).json().data
    await sendRange(uploadId, 14, size, 0, CHUNK)
    await prisma.fileRequest.update({ where: { id: fileRequestId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await sendRange(uploadId, 14, size, CHUNK, size)
    const done = await complete(uploadId)
    expect(done.statusCode, done.body).toBe(200)
  })

  it("...but not past the session's own finite expiry", async () => {
    const { uploadId } = (await create({ filename: "too-slow.bin", sizeBytes: 2 * CHUNK })).json().data
    await prisma.resumableUpload.update({ where: { id: uploadId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const res = await putChunk(uploadId, 0, bytesAt(1, 0, CHUNK))
    expect(res.statusCode).toBe(410)
    expect(res.json().error.code).toBe("UPLOAD_SESSION_EXPIRED")
    expect(existsSync(partialFile(uploadId))).toBe(false)
  })

  it("revoking the request stops an upload mid-transfer and removes its partial", async () => {
    const { uploadId } = (await create({ filename: "revoked.bin", sizeBytes: 3 * CHUNK })).json().data
    await sendRange(uploadId, 15, 3 * CHUNK, 0, CHUNK)
    await prisma.fileRequest.update({ where: { id: fileRequestId }, data: { revokedAt: new Date(), status: "REVOKED" } })
    const res = await putChunk(uploadId, CHUNK, bytesAt(15, CHUNK, CHUNK))
    expect(res.statusCode).toBe(410)
    expect(res.json().error.code).toBe("REQUEST_REVOKED")
    expect((await prisma.resumableUpload.findUniqueOrThrow({ where: { id: uploadId } })).status).toBe("CANCELLED")
    expect(existsSync(partialFile(uploadId))).toBe(false)
  })
})

describe("space and limits", () => {
  it("refuses before any byte moves when the disk cannot hold the file", async () => {
    capacity.read = async () => ({ writable: true, totalBytes: 100 * GIB, availableBytes: Math.floor(1.4 * GIB) })
    const res = await create({ filename: "two-gigs.mp4", sizeBytes: 2 * GIB })
    expect(res.statusCode).toBe(507)
    expect(res.json().error.code).toBe("INSUFFICIENT_STORAGE")
    expect(res.json().error.details.requiredBytes).toBeGreaterThan(2 * GIB)
    // Free space net of what other open uploads have reserved.
    expect(res.json().error.details.availableBytes).toBeLessThanOrEqual(Math.floor(1.4 * GIB))
    expect(await prisma.resumableUpload.count({ where: { fileRequestId } })).toBe(0)
  })

  it("two uploads cannot both claim the same free space", async () => {
    // 5 GiB + margin free: room for one 4 GiB file, not two.
    capacity.read = async () => ({ writable: true, totalBytes: 50 * GIB, availableBytes: 5 * GIB + GIB })
    const [a, b] = await Promise.all([
      create({ filename: "a.mp4", sizeBytes: 4 * GIB }),
      create({ filename: "b.mp4", sizeBytes: 4 * GIB }),
    ])
    const codes = [a.statusCode, b.statusCode].sort()
    expect(codes).toEqual([201, 507])
    // Cancelling the first releases its reservation.
    const winner = (a.statusCode === 201 ? a : b).json().data.uploadId
    await app.inject({ method: "DELETE", url: `${base()}/${winner}` })
    expect((await create({ filename: "b.mp4", sizeBytes: 4 * GIB })).statusCode).toBe(201)
  })

  it("larger than the server-wide maximum is UPLOAD_TOO_LARGE", async () => {
    const res = await create({ filename: "huge.bin", sizeBytes: 2 * 1024 * GIB })
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe("UPLOAD_TOO_LARGE")
    expect(res.json().error.details.maximumUploadBytes).toBeGreaterThan(0)
  })

  it("larger than the request's own maximum is refused", async () => {
    const fr = await createRequest({ maxFileSizeBytes: BigInt(CHUNK) })
    const res = await create({ filename: "x.bin", sizeBytes: 2 * CHUNK }, fr.raw)
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe("UPLOAD_TOO_LARGE")
  })

  it("the public page learns the limit and chunk size before a file is chosen", async () => {
    const res = await app.inject({ method: "GET", url: `/api/public/file-requests/${token}` })
    expect(res.json().data.upload).toMatchObject({ resumable: true, chunkSize: CHUNK })
    expect(res.json().data.upload.maximumUploadBytes).toBeGreaterThan(0)
  })

  it("one submitter cannot open unlimited parallel sessions", async () => {
    const results = []
    for (let i = 0; i < 5; i++) results.push((await create({ filename: `p${i}.bin`, sizeBytes: CHUNK })).statusCode)
    expect(results.slice(0, 3)).toEqual([201, 201, 201])
    expect(results[3]).toBe(429)
  })

  it("the same file name twice gives two files, not an overwrite", async () => {
    await uploadWhole(16, CHUNK, "report.pdf")
    await uploadWhole(17, CHUNK, "report.pdf")
    const assets = await prisma.asset.findMany({ where: { fileRequestId, originalFilename: "report.pdf" } })
    expect(assets).toHaveLength(2)
    expect(new Set(assets.map((a) => a.checksumSha256)).size).toBe(2)
  })
})

describe("cancel and cleanup", () => {
  it("cancel removes the partial and stops the session", async () => {
    const { uploadId } = (await create({ filename: "cancel.bin", sizeBytes: 3 * CHUNK })).json().data
    await sendRange(uploadId, 18, 3 * CHUNK, 0, CHUNK)
    const res = await app.inject({ method: "DELETE", url: `${base()}/${uploadId}` })
    expect(res.json().data.status).toBe("CANCELLED")
    expect(existsSync(partialFile(uploadId))).toBe(false)
    expect((await putChunk(uploadId, CHUNK, bytesAt(18, CHUNK, CHUNK))).json().error.code).toBe("UPLOAD_NOT_ACCEPTING")
  })

  it("cleanup expires abandoned sessions, deletes orphans, and never touches live ones", async () => {
    const { cleanupResumableUploads } = await import("../../apps/api/src/services/file-requests/resumable-cleanup")
    const live = (await create({ filename: "live.bin", sizeBytes: 2 * CHUNK })).json().data.uploadId
    const abandoned = (await create({ filename: "old.bin", sizeBytes: 2 * CHUNK })).json().data.uploadId
    await sendRange(abandoned, 19, 2 * CHUNK, 0, CHUNK)
    await prisma.resumableUpload.update({ where: { id: abandoned }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const orphan = partialFile("cmorphanorphanorphan0001")
    await (await open(orphan, "w")).close()
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await utimes(orphan, old, old)

    const report = await cleanupResumableUploads(prisma, root)
    expect(report.expired).toBeGreaterThanOrEqual(1)
    expect(existsSync(partialFile(abandoned))).toBe(false)
    expect(existsSync(orphan)).toBe(false)
    expect(existsSync(partialFile(live))).toBe(true)
    expect((await prisma.resumableUpload.findUniqueOrThrow({ where: { id: abandoned } })).status).toBe("EXPIRED")
    const left = await readdir(path.join(root, "temp", "resumable"))
    expect(left).toContain(`${live}.partial`)
  })
})

describe("compatibility with the one-request path, and processing after finalize", () => {
  // 1×1 transparent PNG: a real image, so the worker pipeline is engaged.
  const PNG = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
      "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
    "hex",
  )

  async function processingQueuedFor(assetId: string) {
    return prisma.uploadOutbox.count({ where: { payload: { path: ["assetId"], equals: assetId } } })
  }

  it("a small file sent as one multipart POST to /submissions still lands and is queued for processing", async () => {
    const boundary = "----arciin-compat"
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="small.png"\r\nContent-Type: image/png\r\n\r\n`),
      PNG,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    const res = await app.inject({
      method: "POST",
      url: `/api/public/file-requests/${token}/submissions`,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "idempotency-key": crypto.randomUUID() },
      payload: body,
    })
    expect(res.statusCode, res.body).toBe(201)
    expect(res.json().data).toMatchObject({ fileName: "small.png", sizeBytes: PNG.length })
    const asset = await prisma.asset.findFirstOrThrow({
      where: { folderId, originalFilename: "small.png" },
      include: { storageObject: true },
    })
    expect(Number(asset.sizeBytes)).toBe(PNG.length)
    expect(asset.storageObject?.checksumSha256).toBe(createHash("sha256").update(PNG).digest("hex"))
    expect(await processingQueuedFor(asset.id)).toBeGreaterThan(0)
  })

  it("a resumable upload hands the finalized asset to the same processing pipeline", async () => {
    const created = await create({ filename: "resumable.png", sizeBytes: PNG.length })
    expect(created.statusCode, created.body).toBe(201)
    const { uploadId } = created.json().data
    expect((await putChunk(uploadId, 0, PNG)).statusCode).toBe(200)
    const done = await complete(uploadId)
    expect(done.statusCode, done.body).toBe(200)
    const asset = await assetFor(uploadId)
    expect(asset.folderId).toBe(folderId)
    expect(await processingQueuedFor(asset.id)).toBeGreaterThan(0)
  })
})
