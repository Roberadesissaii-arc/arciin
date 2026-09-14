import { BackupPathError, backupPathBasename, backupPathParent, normalizeBackupRelativePath } from "@arciin/shared"
import type { Prisma, PrismaClient, SyncEntry, SyncRoot } from "@prisma/client"

import { slugify } from "@/services/slug"

import { BackupError } from "./errors"
import { folderSlugForSegment } from "./library"
import { refreshBackupCounters } from "./profile"

export function wrapBackupPathError(error: unknown): never {
  if (error instanceof BackupPathError) {
    throw new BackupError(error.code, error.message, 400)
  }
  throw error
}

export function safeRelativePath(input: string): string {
  try {
    return normalizeBackupRelativePath(input)
  } catch (error) {
    wrapBackupPathError(error)
  }
}

export async function getOwnedRoot(
  prisma: PrismaClient,
  input: { rootId: string; profileId: string },
): Promise<SyncRoot> {
  const root = await prisma.syncRoot.findFirst({
    where: { id: input.rootId, profileId: input.profileId },
  })
  if (!root) {
    throw new BackupError("BACKUP_ROOT_NOT_FOUND", "Protected folder not found.", 404)
  }
  if (root.status === "DISABLED") {
    throw new BackupError("SYNC_ROOT_DISABLED", "This protected folder is no longer backing up.", 403)
  }
  return root
}

async function ensureFolderAtPath(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: {
    libraryId: string
    parentFolderId: string
    parentPathCache: string
    name: string
    uniqueHint: string
  },
) {
  const slug = folderSlugForSegment(input.name, input.uniqueHint)
  const pathCache = `${input.parentPathCache}/${slug}`
  const existing = await prisma.folder.findFirst({
    where: { libraryId: input.libraryId, pathCache, deletedAt: null },
  })
  if (existing) {
    if (existing.name !== input.name) {
      return prisma.folder.update({ where: { id: existing.id }, data: { name: input.name } })
    }
    return existing
  }
  return prisma.folder.create({
    data: {
      libraryId: input.libraryId,
      parentFolderId: input.parentFolderId,
      name: input.name,
      slug: slugify(slug) || slug,
      pathCache,
    },
  })
}

export async function ensureFolderChain(
  prisma: PrismaClient,
  root: SyncRoot,
  relativePath: string,
): Promise<{ folderId: string; parentRelativePath: string }> {
  const normalized = safeRelativePath(relativePath)
  const parentPath = backupPathParent(normalized)
  const rootFolder = await prisma.folder.findUnique({ where: { id: root.folderId } })
  if (!rootFolder) {
    throw new BackupError("BACKUP_ROOT_NOT_FOUND", "Protected folder is missing.", 404)
  }

  if (!parentPath) {
    return { folderId: rootFolder.id, parentRelativePath: "" }
  }

  const segments = parentPath.split("/")
  let parentId = rootFolder.id
  let pathCache = rootFolder.pathCache
  let walked = ""

  for (const [index, segment] of segments.entries()) {
    walked = walked ? `${walked}/${segment}` : segment
    const folder = await ensureFolderAtPath(prisma, {
      libraryId: rootFolder.libraryId,
      parentFolderId: parentId,
      parentPathCache: pathCache,
      name: segment,
      uniqueHint: `seg-${index}-${root.id.slice(-6)}`,
    })
    parentId = folder.id
    pathCache = folder.pathCache
  }

  return { folderId: parentId, parentRelativePath: parentPath }
}

export async function upsertFolderEntry(
  prisma: PrismaClient,
  input: {
    root: SyncRoot
    clientEntryId: string
    relativePath: string
    modifiedAtClient?: Date | null
  },
) {
  const relativePath = safeRelativePath(input.relativePath)
  if (!relativePath) {
    throw new BackupError("PATH_INVALID", "A folder entry cannot be the root itself.", 400)
  }
  const name = backupPathBasename(relativePath)
  const { folderId: parentId } = await ensureFolderChain(prisma, input.root, relativePath)
  const rootFolder = await prisma.folder.findUniqueOrThrow({ where: { id: input.root.folderId } })
  const folder = await ensureFolderAtPath(prisma, {
    libraryId: rootFolder.libraryId,
    parentFolderId: parentId,
    parentPathCache:
      (await prisma.folder.findUniqueOrThrow({ where: { id: parentId } })).pathCache,
    name,
    uniqueHint: input.clientEntryId.slice(0, 8),
  })

  const entry = await prisma.syncEntry.upsert({
    where: {
      syncRootId_clientEntryId: {
        syncRootId: input.root.id,
        clientEntryId: input.clientEntryId,
      },
    },
    create: {
      syncRootId: input.root.id,
      clientEntryId: input.clientEntryId,
      relativePath,
      entryType: "FOLDER",
      folderId: folder.id,
      modifiedAtClient: input.modifiedAtClient ?? null,
      syncState: "ACTIVE",
      deletedAt: null,
    },
    update: {
      relativePath,
      folderId: folder.id,
      modifiedAtClient: input.modifiedAtClient ?? undefined,
      syncState: "ACTIVE",
      deletedAt: null,
    },
  })

  await refreshBackupCounters(prisma, input.root.profileId)
  return entry
}

export async function findEntry(
  prisma: PrismaClient,
  input: { rootId: string; clientEntryId: string },
): Promise<SyncEntry> {
  const entry = await prisma.syncEntry.findUnique({
    where: {
      syncRootId_clientEntryId: {
        syncRootId: input.rootId,
        clientEntryId: input.clientEntryId,
      },
    },
  })
  if (!entry) {
    throw new BackupError("BACKUP_ENTRY_NOT_FOUND", "Sync entry not found.", 404)
  }
  return entry
}

export async function moveSyncEntry(
  prisma: PrismaClient,
  input: {
    root: SyncRoot
    clientEntryId: string
    relativePath: string
  },
) {
  const entry = await findEntry(prisma, {
    rootId: input.root.id,
    clientEntryId: input.clientEntryId,
  })
  const relativePath = safeRelativePath(input.relativePath)
  if (entry.entryType === "FOLDER") {
    return upsertFolderEntry(prisma, {
      root: input.root,
      clientEntryId: input.clientEntryId,
      relativePath,
    })
  }

  const { folderId } = await ensureFolderChain(prisma, input.root, relativePath)
  const name = backupPathBasename(relativePath)
  const updated = await prisma.syncEntry.update({
    where: { id: entry.id },
    data: {
      relativePath,
      syncState: "ACTIVE",
      deletedAt: null,
    },
  })
  if (entry.assetId) {
    await prisma.asset.update({
      where: { id: entry.assetId },
      data: {
        folderId,
        originalFilename: name,
        filename: name,
      },
    })
  }
  await refreshBackupCounters(prisma, input.root.profileId)
  return updated
}

export async function tombstoneSyncEntry(
  prisma: PrismaClient,
  input: {
    root: SyncRoot
    clientEntryId: string
    ownerId?: string
  },
) {
  void input.ownerId
  const entry = await findEntry(prisma, {
    rootId: input.root.id,
    clientEntryId: input.clientEntryId,
  })
  if (entry.syncState === "TOMBSTONED") return entry

  if (entry.assetId) {
    await prisma.asset.update({
      where: { id: entry.assetId },
      data: { deletedAt: new Date(), status: "DELETED" },
    })
  }
  if (entry.folderId && entry.entryType === "FOLDER") {
    await prisma.folder.update({
      where: { id: entry.folderId },
      data: { deletedAt: new Date() },
    })
  }

  const updated = await prisma.syncEntry.update({
    where: { id: entry.id },
    data: { syncState: "TOMBSTONED", deletedAt: new Date() },
  })
  await refreshBackupCounters(prisma, input.root.profileId)
  return updated
}
