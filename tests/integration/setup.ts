import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { PrismaClient } from "@prisma/client"

import { assertIsolatedTestEnvironment } from "./guard"

/** Nothing else in this module runs until isolation is proven. */
assertIsolatedTestEnvironment()

export const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
})

let storageRoot: string | null = null

export async function createTestStorageRoot(): Promise<string> {
  storageRoot = await mkdtemp(path.join(tmpdir(), "arciin-itest-storage-"))
  return storageRoot
}

export async function removeTestStorageRoot(): Promise<void> {
  if (!storageRoot) return
  // Guarded by the isolation check above, but re-assert before any recursive
  // delete — this is the one operation that could destroy real files.
  if (!storageRoot.startsWith(tmpdir())) {
    throw new Error(`Refusing to remove storage root outside tmp: ${storageRoot}`)
  }
  await rm(storageRoot, { recursive: true, force: true })
  storageRoot = null
}

/**
 * Wipe every table the upload path touches, in FK-safe order.
 * Runs before each test file so cases never see each other's rows.
 */
export async function resetDatabase(): Promise<void> {
  await prisma.$transaction([
    prisma.uploadOutbox.deleteMany(),
    prisma.uploadSession.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.folder.deleteMany(),
    prisma.library.deleteMany(),
    prisma.storageObject.deleteMany(),
    prisma.storageLocation.deleteMany(),
    prisma.job.deleteMany(),
    prisma.activityEvent.deleteMany(),
    prisma.deviceSession.deleteMany(),
    prisma.devicePairing.deleteMany(),
    prisma.session.deleteMany(),
    prisma.device.deleteMany(),
    prisma.user.deleteMany(),
  ])
}

export type Fixtures = Awaited<ReturnType<typeof seedBaseFixtures>>

/** The five default libraries plus an owner, matching a real instance. */
export async function seedBaseFixtures(root: string) {
  const user = await prisma.user.create({
    data: {
      email: `itest-${Date.now()}@example.invalid`,
      name: "Integration Test",
      passwordHash: "not-a-real-hash",
      role: "OWNER",
      status: "ACTIVE",
    },
  })

  const storageLocation = await prisma.storageLocation.create({
    data: { name: "Test Storage", type: "LOCAL", rootPath: root, isDefault: true },
  })

  const libraryKinds = [
    ["Videos", "videos", "VIDEO"],
    ["Images", "images", "IMAGE"],
    ["Music", "music", "AUDIO"],
    ["Documents", "documents", "DOCUMENT"],
    ["Inbox", "inbox", "INBOX"],
    ["Computers", "computers", "COMPUTER"],
  ] as const

  const libraries: Record<string, { id: string; kind: string }> = {}
  for (const [name, slug, kind] of libraryKinds) {
    const library = await prisma.library.create({
      data: { name, slug, kind, storageLocationId: storageLocation.id },
    })
    libraries[slug] = { id: library.id, kind }
  }

  return { user, storageLocation, libraries }
}

let objectCounter = 0

/** Create an asset with its backing storage object. */
export async function createAsset(
  fixtures: Fixtures,
  input: {
    librarySlug: keyof Fixtures["libraries"] | string
    folderId?: string | null
    mediaType?: "VIDEO" | "IMAGE" | "AUDIO" | "DOCUMENT" | "ARCHIVE" | "APPLICATION" | "CODE" | "OTHER"
    status?: "UPLOADING" | "PROCESSING" | "READY" | "FAILED" | "DELETED"
    originalFilename?: string
    extension?: string
    mimeType?: string
    createdAt?: Date
    deletedAt?: Date | null
    /** Zero is meaningful: it is what a failed upload leaves behind. */
    sizeBytes?: number
  },
) {
  objectCounter += 1
  const checksum = `itest${String(objectCounter).padStart(59, "0")}`

  const storageObject = await prisma.storageObject.create({
    data: {
      storageLocationId: fixtures.storageLocation.id,
      objectKey: `objects/it/${objectCounter}/${checksum}.bin`,
      physicalPath: `${fixtures.storageLocation.rootPath}/objects/${checksum}.bin`,
      sizeBytes: BigInt(input.sizeBytes ?? 10),
      checksumSha256: checksum,
      mimeType: input.mimeType ?? "application/octet-stream",
    },
  })

  return prisma.asset.create({
    data: {
      libraryId: fixtures.libraries[input.librarySlug as string].id,
      folderId: input.folderId ?? null,
      storageObjectId: storageObject.id,
      ownerId: fixtures.user.id,
      filename: `${checksum}.bin`,
      originalFilename: input.originalFilename ?? `file-${objectCounter}.bin`,
      mimeType: input.mimeType ?? "application/octet-stream",
      mediaType: input.mediaType ?? "OTHER",
      extension: input.extension ?? "bin",
      sizeBytes: BigInt(input.sizeBytes ?? 10),
      checksumSha256: checksum,
      status: input.status ?? "READY",
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      ...(input.deletedAt ? { deletedAt: input.deletedAt } : {}),
    },
  })
}

export async function createFolder(
  fixtures: Fixtures,
  input: {
    librarySlug: string
    name: string
    /** Nests the folder, and builds the pathCache the cascade queries rely on. */
    parentFolderId?: string | null
    deletedAt?: Date | null
    hideFromAllFiles?: boolean
    lockedAt?: Date | null
  },
) {
  const slug = input.name.toLowerCase().replace(/\s+/g, "-")
  const parent = input.parentFolderId
    ? await prisma.folder.findUniqueOrThrow({ where: { id: input.parentFolderId } })
    : null

  return prisma.folder.create({
    data: {
      libraryId: fixtures.libraries[input.librarySlug].id,
      name: input.name,
      slug,
      parentFolderId: input.parentFolderId ?? null,
      pathCache: parent ? `${parent.pathCache}/${slug}` : `/${slug}`,
      deletedAt: input.deletedAt ?? null,
      hideFromAllFiles: input.hideFromAllFiles ?? false,
      lockedAt: input.lockedAt ?? null,
    },
  })
}
