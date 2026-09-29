import { chmod, link, mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { hashToken } from "../../apps/api/src/services/security/auth"
import { auditStorage, type StorageAudit } from "../../apps/api/src/services/storage/storage-audit"
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
 * The read-only storage audit, against temporary directories only.
 *
 * It must count what is there, be conservative about "orphans" (a shared
 * object with one deleted asset is not one; a brand-new object is not one),
 * count hard-linked backups once, never follow a symlink out of a root, stop
 * at its budget, survive unreadable directories — and change nothing.
 */

let fixtures: Fixtures
let root: string
let backupDir: string
let outside: string
let audit: StorageAudit
const DAY = 86_400_000
const old = new Date(Date.now() - 3 * DAY)

async function file(p: string, bytes: number, mtime?: Date) {
  await mkdir(path.dirname(p), { recursive: true })
  await writeFile(p, Buffer.alloc(bytes, 7))
  if (mtime) await utimes(p, mtime, mtime)
}

async function objectWithFile(input: Parameters<typeof createAsset>[1] & { bytes: number }) {
  const asset = await createAsset(fixtures, { ...input, sizeBytes: input.bytes })
  const so = await prisma.storageObject.update({ where: { id: asset.storageObjectId }, data: { createdAt: old } })
  await file(so.physicalPath, input.bytes, old)
  return { asset, so }
}

beforeAll(async () => {
  await resetDatabase()
  root = await createTestStorageRoot()
  fixtures = await seedBaseFixtures(root)
  const tmp = await mkdtemp(path.join(os.tmpdir(), "arciin-audit-"))
  backupDir = path.join(tmp, "backups")
  outside = path.join(tmp, "outside")
  await file(path.join(outside, "secret.bin"), 50_000)

  // Active object.
  const active = await objectWithFile({ librarySlug: "images", mediaType: "IMAGE", bytes: 1_000 })
  // One object shared by a live asset and a deleted one: active, not trash.
  const shared = await objectWithFile({ librarySlug: "images", mediaType: "IMAGE", bytes: 2_000 })
  await prisma.asset.create({
    data: { ...(await prisma.asset.findUniqueOrThrow({ where: { id: shared.asset.id }, select: { libraryId: true, ownerId: true, filename: true, originalFilename: true, mimeType: true, mediaType: true, extension: true, sizeBytes: true, checksumSha256: true, status: true } })), storageObjectId: shared.so.id, deletedAt: new Date() },
  })
  // Only deleted assets: trash.
  const trashed = await objectWithFile({ librarySlug: "images", mediaType: "IMAGE", bytes: 4_000 })
  await prisma.asset.update({ where: { id: trashed.asset.id }, data: { deletedAt: new Date() } })
  // Archived.
  const archived = await objectWithFile({ librarySlug: "documents", mediaType: "DOCUMENT", bytes: 8_000 })
  await prisma.asset.update({ where: { id: archived.asset.id }, data: { archivedAt: new Date() } })
  // A row no asset references, old: an orphan candidate. And a new one: not.
  const orphan = await objectWithFile({ librarySlug: "images", bytes: 16_000 })
  await prisma.asset.delete({ where: { id: orphan.asset.id } })
  const fresh = await createAsset(fixtures, { librarySlug: "images", sizeBytes: 32_000 })
  await prisma.asset.delete({ where: { id: fresh.id } })
  // An upload that failed: its row exists, its file never landed.
  const failedUpload = await createAsset(fixtures, { librarySlug: "images", mediaType: "IMAGE", sizeBytes: 128, status: "FAILED" })
  void failedUpload
  // A row whose file is missing, and one stored on another drive.
  const missing = await createAsset(fixtures, { librarySlug: "images", sizeBytes: 64 })
  void missing
  const elsewhere = await createAsset(fixtures, { librarySlug: "images", sizeBytes: 64 })
  await prisma.storageObject.update({ where: { id: elsewhere.storageObjectId }, data: { physicalPath: path.join(outside, "elsewhere.bin") } })

  // A file on disk nothing points at (old), and a new one (grace period).
  await file(path.join(root, "objects", "stray-old.bin"), 5_000, old)
  await file(path.join(root, "objects", "stray-new.bin"), 6_000)
  // A symlink out of the storage root: never followed, never counted.
  await symlink(path.join(outside, "secret.bin"), path.join(root, "objects", "escape.bin"))
  await symlink(outside, path.join(root, "objects", "escape-dir"))

  // Thumbnails, temp, logs, and partial uploads (one in progress, one stale).
  await file(path.join(root, "thumbnails", "a.webp"), 300)
  await file(path.join(root, "temp", "x.tmp"), 700)
  await file(path.join(root, "logs", "api.log"), 900)
  await prisma.instanceConfig.create({ data: { instanceName: "Audit", storageRoot: root, initializedAt: new Date(), licensePlan: "free", licenseStatus: "none" } })
  const fr = await prisma.fileRequest.create({
    data: {
      instanceId: (await prisma.instanceConfig.findFirstOrThrow()).id,
      createdByUserId: fixtures.user.id,
      destinationLibraryId: fixtures.libraries.documents!.id,
      destinationFolderId: (await createFolder(fixtures, { librarySlug: "documents", name: "Incoming" })).id,
      title: "Audit",
      tokenHash: hashToken(`frq_${crypto.randomUUID()}`),
      tokenPrefix: "frq_audit",
      status: "ACTIVE",
      allowAnonymous: true,
    },
  })
  const upload = await prisma.resumableUpload.create({
    data: { fileRequestId: fr.id, filename: "big.mov", sizeBytes: BigInt(1_000_000), chunkSize: 1024, abuseIdentifierHash: "x", expiresAt: new Date(Date.now() + DAY) },
  })
  await file(path.join(root, "temp", "resumable", `${upload.id}.partial`), 1_024)
  await file(path.join(root, "temp", "resumable", "abandoned.partial"), 2_048)

  // Backups: snapshot 1 hard-links a live object; snapshot 2 hard-links
  // snapshot 1's copy (as rsync --link-dest does); one real copy besides.
  const snap1 = path.join(backupDir, "20260101-031500", "storage")
  const snap2 = path.join(backupDir, "20260102-031500", "storage")
  await mkdir(snap1, { recursive: true })
  await mkdir(snap2, { recursive: true })
  await link(active.so.physicalPath, path.join(snap1, "active.bin"))
  await link(path.join(snap1, "active.bin"), path.join(snap2, "active.bin"))
  await file(path.join(snap2, "copy.bin"), 10_000)
  await mkdir(path.join(backupDir, "manual-predeploy"), { recursive: true })

  audit = await auditStorage({ prisma, storageRoot: root, backupDir, appLogDir: null, ollamaModelsDir: null })
})

afterAll(async () => {
  await rm(path.dirname(backupDir), { recursive: true, force: true })
  await prisma.resumableUpload.deleteMany()
  await prisma.fileRequest.deleteMany()
  await prisma.instanceConfig.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

describe("storage audit", () => {
  it("reads the filesystem", () => {
    expect(audit.filesystem!.totalBytes).toBeGreaterThan(0)
    expect(audit.filesystem!.freeBytes).toBeGreaterThan(0)
    expect(audit.truncated).toBe(false)
  })

  it("puts each object in the strongest state any of its assets is in", () => {
    // The shared object, the plain one, and the two whose files are missing or
    // elsewhere: each still has a live asset.
    expect(audit.database.byState.active).toEqual({ count: 4, bytes: 1_000 + 2_000 + 64 + 64 })
    expect(audit.database.byState.archived).toEqual({ count: 1, bytes: 8_000 })
    expect(audit.database.byState.trash).toEqual({ count: 1, bytes: 4_000 })
    expect(audit.database.byState.failed).toEqual({ count: 1, bytes: 128 })
  })

  it("an orphan candidate needs no asset at all, and to be past the grace period", () => {
    expect(audit.database.orphanCandidates).toEqual({ count: 1, bytes: 16_000 })
    expect(audit.database.recentUnreferenced).toEqual({ count: 1, bytes: 32_000 })
  })

  it("finds files nothing points at, but not brand-new ones", () => {
    expect(audit.physical.objects.orphanCandidates).toEqual({ count: 1, bytes: 5_000 })
  })

  it("reports missing files and objects stored elsewhere separately", () => {
    // `fresh`, `missing` and the failed upload never had a file written;
    // `elsewhere` is on another drive.
    expect(audit.database.missingFiles).toBe(3)
    expect(audit.database.elsewhere).toBe(1)
  })

  it("never follows a symlink out of the root", () => {
    expect(audit.physical.objects.symlinksSkipped).toBe(2)
    // 50 KB behind the link is not in any total.
    expect(audit.physical.objects.uniqueBytes).toBe(1_000 + 2_000 + 4_000 + 8_000 + 16_000 + 5_000 + 6_000)
  })

  it("counts partial uploads, and which are still in progress", () => {
    expect(audit.physical.resumablePartials).toMatchObject({ files: 2, uniqueBytes: 3_072, withActiveUpload: 1, stale: 1 })
    expect(audit.physical.temp.uniqueBytes).toBe(700)
    expect(audit.physical.thumbnails.uniqueBytes).toBe(300)
    expect(audit.physical.storageLogs.uniqueBytes).toBe(900)
  })

  it("counts hard-linked backups once, and knows what they share with live storage", () => {
    expect(audit.backups).toMatchObject({
      available: true,
      snapshots: 3,
      files: 3,
      apparentBytes: 1_000 + 1_000 + 10_000,
      uniqueBytes: 1_000 + 10_000,
      sharedWithStorageBytes: 1_000,
    })
  })

  it("holds no path in its result", () => {
    const text = JSON.stringify(audit)
    for (const p of [root, backupDir, outside]) expect(text).not.toContain(p)
  })

  it("stops at its budget and says so", async () => {
    const quick = await auditStorage({ prisma, storageRoot: root, backupDir, budgetMs: 0 })
    expect(quick.truncated).toBe(true)
    const few = await auditStorage({ prisma, storageRoot: root, backupDir: null, maxEntries: 3 })
    expect(few.truncated).toBe(true)
    expect(few.physical.objects.truncated).toBe(true)
  })

  it("an unreadable directory is counted, not fatal", async () => {
    const locked = path.join(root, "thumbnails", "locked")
    await mkdir(locked, { recursive: true })
    await file(path.join(locked, "x.webp"), 10)
    await chmod(locked, 0o000)
    try {
      const again = await auditStorage({ prisma, storageRoot: root, backupDir: null })
      // Root can read anything; a normal user cannot.
      if (process.getuid?.() !== 0) expect(again.physical.thumbnails.unreadable).toBe(1)
      expect(again.physical.thumbnails.available).toBe(true)
    } finally {
      await chmod(locked, 0o755)
      await rm(locked, { recursive: true, force: true })
    }
  })

  it("a missing backup tree or storage root is reported, not thrown", async () => {
    const none = await auditStorage({ prisma, storageRoot: path.join(root, "nope"), backupDir: path.join(root, "nope") })
    expect(none.physical.objects.available).toBe(false)
    expect(none.backups!.available).toBe(false)
  })

  it("changed nothing on disk or in the database", async () => {
    const [objects, assets] = await Promise.all([prisma.storageObject.count(), prisma.asset.count()])
    const again = await auditStorage({ prisma, storageRoot: root, backupDir })
    expect([await prisma.storageObject.count(), await prisma.asset.count()]).toEqual([objects, assets])
    expect(again.physical.objects.files).toBe(audit.physical.objects.files)
  })
})

describe("storage audit routes", () => {
  async function buildApp() {
    const Fastify = (await import("fastify")).default
    const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
    const { registerStorageAuditRoutes, resetStorageAuditRuns } = await import("../../apps/api/src/modules/admin/storage-audit.routes")
    resetStorageAuditRuns()
    const a = Fastify({ logger: false })
    a.decorate("prisma", prisma)
    await registerCookies(a)
    await a.register(async (api) => registerStorageAuditRoutes(api), { prefix: "/api" })
    await a.ready()
    return a
  }
  async function cookieFor(role: "OWNER" | "MEMBER") {
    const user = role === "OWNER" ? fixtures.user : await prisma.user.create({ data: { email: `audit-${crypto.randomUUID()}@x.invalid`, name: "M", passwordHash: "x", role, status: "ACTIVE" } })
    const raw = `sess_${crypto.randomUUID()}`
    await prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + DAY) } })
    return `arciin_session=${raw}`
  }

  it("starts in the background, reports when done, and is owner/admin only", async () => {
    const app = await buildApp()
    try {
      const owner = await cookieFor("OWNER")
      const member = await cookieFor("MEMBER")
      expect((await app.inject({ method: "POST", url: "/api/admin/storage-audit" })).statusCode).toBe(401)
      expect((await app.inject({ method: "POST", url: "/api/admin/storage-audit", headers: { cookie: member } })).statusCode).toBe(403)
      const started = await app.inject({ method: "POST", url: "/api/admin/storage-audit", headers: { cookie: owner } })
      expect(started.statusCode).toBe(202)
      const id = started.json().data.id as string
      // A second start while one runs returns the same run.
      const again = await app.inject({ method: "POST", url: "/api/admin/storage-audit", headers: { cookie: owner } })
      expect(again.json().data.id).toBe(id)
      let run: { status: string; result: StorageAudit | null } = { status: "running", result: null }
      for (let i = 0; i < 100 && run.status === "running"; i++) {
        await new Promise((r) => setTimeout(r, 50))
        run = (await app.inject({ method: "GET", url: `/api/admin/storage-audit/${id}`, headers: { cookie: owner } })).json().data
      }
      expect(run.status).toBe("done")
      expect(run.result!.database.storageObjects.count).toBeGreaterThan(0)
      const latest = await app.inject({ method: "GET", url: "/api/admin/storage-audit/latest", headers: { cookie: owner } })
      expect(latest.json().data.id).toBe(id)
      expect(latest.body).not.toContain(root)
      // Read-only: there is nothing to delete with.
      for (const method of ["DELETE", "PATCH", "PUT"] as const) {
        expect((await app.inject({ method, url: `/api/admin/storage-audit/${id}`, headers: { cookie: owner } })).statusCode).toBe(404)
      }
    } finally {
      await app.close()
    }
  })
})
