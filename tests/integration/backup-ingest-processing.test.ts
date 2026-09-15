import { createHash } from "node:crypto"
import { access } from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { MultipartFile } from "@fastify/multipart"
import type { FastifyBaseLogger } from "fastify"
import { buildObjectKey, candidateStorageObjectPaths } from "@arciin/storage"

import { hashPassword } from "../../apps/api/src/services/security/auth"
import { claimDevicePairing, createDevicePairing } from "../../apps/api/src/services/devices/pairing"
import { enableBackupProfile } from "../../apps/api/src/services/backup/profile"
import { ingestBackupFile } from "../../apps/api/src/services/backup/ingest"
import { moveSyncEntry, tombstoneSyncEntry } from "../../apps/api/src/services/backup/sync"
import {
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

/** 1×1 PNG so file-type/sharp classify this as an image. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)
const PNG_RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
)
const PNG_SHA = createHash("sha256").update(PNG).digest("hex")
const PNG_RED_SHA = createHash("sha256").update(PNG_RED).digest("hex")

const silentLog = { warn() {}, info() {}, error() {}, debug() {}, child() { return silentLog } } as unknown as FastifyBaseLogger

function multipart(filename: string, body: Buffer): MultipartFile {
  return {
    type: "file",
    fieldname: "file",
    filename,
    encoding: "7bit",
    mimetype: "image/png",
    file: Readable.from(body),
    fields: {},
    toBuffer: async () => body,
  } as unknown as MultipartFile
}

async function exists(p: string) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

let fixtures: Fixtures
let ownerId: string
let storageRoot: string

async function pairDevice() {
  const { code } = await createDevicePairing(prisma, ownerId)
  return claimDevicePairing(prisma, {
    code,
    name: "Processing Test Desktop",
    platform: "windows",
    deviceType: "desktop",
    protocolVersion: 1,
  })
}

async function protectTestRoot() {
  const paired = await pairDevice()
  const enabled = await enableBackupProfile(prisma, {
    userId: ownerId,
    deviceId: paired.device.id,
    roots: [
      {
        kind: "CUSTOM",
        displayName: "ComputerBackupProcessingTest",
        sourcePathIdentifier: "processing-test-root",
      },
    ],
  })
  return enabled.profile.roots[0]!
}

beforeAll(async () => {
  storageRoot = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(storageRoot)
  ownerId = fixtures.user.id
  await prisma.user.update({
    where: { id: ownerId },
    data: { passwordHash: await hashPassword("TestPass123!") },
  })
  await prisma.instanceConfig.deleteMany()
  await prisma.instanceConfig.create({
    data: {
      instanceName: "Arciin Home",
      storageRoot,
      initializedAt: new Date(),
      licensePlan: "free",
      licenseStatus: "none",
    },
  })
})

afterAll(async () => {
  await resetDatabase()
  await prisma.instanceConfig.deleteMany()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.syncEntry.deleteMany()
  await prisma.syncRoot.deleteMany()
  await prisma.deviceBackupGrant.deleteMany()
  await prisma.deviceBackupProfile.deleteMany()
  await prisma.deviceSession.deleteMany()
  await prisma.devicePairing.deleteMany()
  await prisma.session.deleteMany()
  await prisma.device.deleteMany()
  await prisma.job.deleteMany()
  await prisma.uploadOutbox.deleteMany()
  await prisma.uploadSession.deleteMany()
  await prisma.asset.deleteMany()
  await prisma.storageObject.deleteMany()
})

describe("computer backup processing originals", () => {
  it("heals a ghost StorageObject instead of dropping the uploaded bytes", async () => {
    const objectKey = buildObjectKey(PNG_SHA, "png")
    const physicalPath = path.join(storageRoot, objectKey)
    const ghost = await prisma.storageObject.create({
      data: {
        storageLocationId: fixtures.storageLocation.id,
        objectKey,
        physicalPath,
        sizeBytes: BigInt(PNG.length),
        checksumSha256: PNG_SHA,
        mimeType: "image/png",
      },
    })
    expect(await exists(physicalPath)).toBe(false)

    const root = await protectTestRoot()

    const entry = await ingestBackupFile(prisma, {
      root,
      userId: ownerId,
      clientEntryId: "watcher-new-image",
      relativePath: "watcher-new-image.jpg",
      file: multipart("watcher-new-image.jpg", PNG),
      log: silentLog,
    })

    expect(entry.assetId).toBeTruthy()
    expect(await exists(physicalPath)).toBe(true)

    const objects = await prisma.storageObject.findMany({ where: { checksumSha256: PNG_SHA } })
    expect(objects).toHaveLength(1)
    expect(objects[0]!.id).toBe(ghost.id)

    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: entry.assetId! } })
    expect(asset.storageObjectId).toBe(ghost.id)
    expect(asset.uploadClient).toBe("backup")
    expect(asset.status).toBe("PROCESSING")

    const jobs = await prisma.job.findMany({
      where: { payload: { path: ["assetId"], equals: asset.id } },
    })
    expect(jobs.map((j) => j.type).sort()).toEqual(["extract_metadata", "generate_thumbnail"])
    expect(jobs.every((j) => j.status === "QUEUED" || j.status === "ACTIVE" || j.status === "FAILED" || j.status === "COMPLETED")).toBe(true)
  })

  it("does not duplicate the asset when Desktop retries the same entry after a heal", async () => {
    const objectKey = buildObjectKey(PNG_SHA, "png")
    await prisma.storageObject.create({
      data: {
        storageLocationId: fixtures.storageLocation.id,
        objectKey,
        physicalPath: path.join(storageRoot, objectKey),
        sizeBytes: BigInt(PNG.length),
        checksumSha256: PNG_SHA,
        mimeType: "image/png",
      },
    })

    const root = await protectTestRoot()

    const first = await ingestBackupFile(prisma, {
      root,
      userId: ownerId,
      clientEntryId: "watcher-new-image",
      relativePath: "watcher-new-image.jpg",
      file: multipart("watcher-new-image.jpg", PNG),
      log: silentLog,
    })
    const second = await ingestBackupFile(prisma, {
      root,
      userId: ownerId,
      clientEntryId: "watcher-new-image",
      relativePath: "watcher-new-image.jpg",
      file: multipart("watcher-new-image.jpg", PNG),
      log: silentLog,
    })

    expect(second.id).toBe(first.id)
    expect(second.assetId).toBe(first.assetId)
    const assets = await prisma.asset.count({ where: { checksumSha256: PNG_SHA } })
    expect(assets).toBe(1)
    expect(await exists(path.join(storageRoot, objectKey))).toBe(true)
  })

  it("re-places the canonical original and re-queues processing on content change", async () => {
    const root = await protectTestRoot()
    const first = await ingestBackupFile(prisma, {
      root,
      userId: ownerId,
      clientEntryId: "watcher-replace-image",
      relativePath: "image.jpg",
      file: multipart("image.jpg", PNG),
      log: silentLog,
    })
    const firstKey = buildObjectKey(PNG_SHA, "png")
    expect(await exists(path.join(storageRoot, firstKey))).toBe(true)

    const updated = await ingestBackupFile(prisma, {
      root,
      userId: ownerId,
      clientEntryId: "watcher-replace-image",
      relativePath: "image.jpg",
      file: multipart("image.jpg", PNG_RED),
      log: silentLog,
    })

    expect(updated.id).toBe(first.id)
    expect(updated.assetId).toBe(first.assetId)
    expect(updated.contentHash).toBe(PNG_RED_SHA)
    const redPath = path.join(storageRoot, buildObjectKey(PNG_RED_SHA, "png"))
    expect(await exists(redPath)).toBe(true)

    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: updated.assetId! } })
    expect(asset.checksumSha256).toBe(PNG_RED_SHA)
    expect(asset.status).toBe("PROCESSING")
    expect(await prisma.asset.count({ where: { id: asset.id } })).toBe(1)

    const jobs = await prisma.job.findMany({
      where: { payload: { path: ["assetId"], equals: asset.id } },
    })
    expect(jobs.some((j) => j.type === "extract_metadata")).toBe(true)
    expect(jobs.some((j) => j.type === "generate_thumbnail")).toBe(true)
  })

  it("keeps the server original resolvable after a same-root rename", async () => {
    const root = await protectTestRoot()
    const entry = await ingestBackupFile(prisma, {
      root,
      userId: ownerId,
      clientEntryId: "watcher-rename-image",
      relativePath: "image.jpg",
      file: multipart("image.jpg", PNG),
      log: silentLog,
    })
    const objectKey = buildObjectKey(PNG_SHA, "png")
    const physicalPath = path.join(storageRoot, objectKey)
    const before = await prisma.asset.findUniqueOrThrow({
      where: { id: entry.assetId! },
      include: { storageObject: true },
    })

    const moved = await moveSyncEntry(prisma, {
      root,
      clientEntryId: "watcher-rename-image",
      relativePath: "renamed/image.jpg",
    })

    expect(moved.assetId).toBe(entry.assetId)
    expect(moved.relativePath).toBe("renamed/image.jpg")
    expect(await exists(physicalPath)).toBe(true)

    const after = await prisma.asset.findUniqueOrThrow({
      where: { id: entry.assetId! },
      include: { storageObject: true },
    })
    expect(after.storageObjectId).toBe(before.storageObjectId)
    expect(after.storageObject.objectKey).toBe(objectKey)
    expect(after.storageObject.physicalPath).toBe(physicalPath)
    expect(after.originalFilename).toBe("image.jpg")
    expect(after.storageObject.physicalPath.startsWith(storageRoot)).toBe(true)
    expect(after.storageObject.physicalPath.includes("C:")).toBe(false)
  })

  it("tombstones the logical entry without enqueueing work against a missing original", async () => {
    const root = await protectTestRoot()
    const entry = await ingestBackupFile(prisma, {
      root,
      userId: ownerId,
      clientEntryId: "watcher-delete-image",
      relativePath: "image.jpg",
      file: multipart("image.jpg", PNG),
      log: silentLog,
    })
    const jobCountBefore = await prisma.job.count({
      where: { payload: { path: ["assetId"], equals: entry.assetId } },
    })

    const tombstoned = await tombstoneSyncEntry(prisma, {
      root,
      clientEntryId: "watcher-delete-image",
    })
    expect(tombstoned.syncState).toBe("TOMBSTONED")

    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: entry.assetId! } })
    expect(asset.status).toBe("DELETED")
    expect(asset.deletedAt).not.toBeNull()

    const jobCountAfter = await prisma.job.count({
      where: { payload: { path: ["assetId"], equals: entry.assetId } },
    })
    expect(jobCountAfter).toBe(jobCountBefore)
  })

  it("never stores a Windows absolute path as the worker lookup location", async () => {
    const root = await protectTestRoot()
    const entry = await ingestBackupFile(prisma, {
      root,
      userId: ownerId,
      clientEntryId: "watcher-new-image",
      relativePath: "watcher-new-image.jpg",
      file: multipart("watcher-new-image.jpg", PNG),
      log: silentLog,
    })
    const asset = await prisma.asset.findUniqueOrThrow({
      where: { id: entry.assetId! },
      include: { storageObject: true },
    })
    expect(entry.relativePath).toBe("watcher-new-image.jpg")
    expect(asset.storageObject.physicalPath.startsWith(storageRoot)).toBe(true)
    expect(asset.storageObject.objectKey.startsWith("objects/")).toBe(true)
    for (const candidate of candidateStorageObjectPaths(
      storageRoot,
      asset.storageObject.physicalPath,
      asset.storageObject.objectKey,
      [storageRoot],
    )) {
      expect(candidate.startsWith(storageRoot)).toBe(true)
      expect(candidate.toLowerCase().includes("c:\\users")).toBe(false)
    }
  })
})
