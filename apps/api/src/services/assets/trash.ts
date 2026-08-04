import { unlink } from "node:fs/promises"
import path from "node:path"

import type { Asset, Library, PrismaClient, StorageObject } from "@prisma/client"
import { TRASH_RETENTION_DAYS } from "@arciin/shared"
import { resolveArciinStorageRoot } from "@arciin/storage"

import { apiConfig } from "@/config"
import { getStoragePaths } from "@/services/storage/local-storage"
import { serializeAsset } from "@/services/serializers"

export type TrashAssetRow = Asset & {
  library: Pick<Library, "id" | "name" | "slug">
  storageObject: StorageObject
}

export function trashExpiresAt(deletedAt: Date): Date {
  const expires = new Date(deletedAt)
  expires.setUTCDate(expires.getUTCDate() + TRASH_RETENTION_DAYS)
  return expires
}

export function trashDaysRemaining(deletedAt: Date, now = new Date()): number {
  const ms = trashExpiresAt(deletedAt).getTime() - now.getTime()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

export function serializeTrashAsset(asset: TrashAssetRow) {
  const deletedAt = asset.deletedAt ?? asset.updatedAt
  const expiresAt = trashExpiresAt(deletedAt)
  return {
    ...serializeAsset(asset),
    libraryName: asset.library.name,
    librarySlug: asset.library.slug,
    expiresAt: expiresAt.toISOString(),
    daysRemaining: trashDaysRemaining(deletedAt),
    retentionDays: TRASH_RETENTION_DAYS,
  }
}

export async function listTrashedAssets(prisma: PrismaClient) {
  return prisma.asset.findMany({
    where: { deletedAt: { not: null } },
    include: {
      library: { select: { id: true, name: true, slug: true } },
      storageObject: true,
    },
    orderBy: { deletedAt: "desc" },
  })
}

export async function restoreTrashedAsset(prisma: PrismaClient, assetId: string) {
  const existing = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: { not: null } },
    include: {
      library: { select: { id: true, name: true, slug: true } },
      storageObject: true,
    },
  })
  if (!existing) return null

  return prisma.asset.update({
    where: { id: assetId },
    data: {
      deletedAt: null,
      status: "READY",
      processingError: null,
    },
    include: {
      library: { select: { id: true, name: true, slug: true } },
      storageObject: true,
    },
  })
}

async function unlinkThumbnailCandidates(
  assetId: string,
  physicalPath: string,
  configuredRoot: string | null | undefined,
  extraRoots: string[],
) {
  const roots = new Set<string>()
  roots.add(resolveArciinStorageRoot(configuredRoot, physicalPath))
  roots.add(path.resolve(apiConfig.dataDir))
  for (const root of extraRoots) {
    if (root) roots.add(path.resolve(root))
  }

  for (const root of roots) {
    await unlink(path.join(getStoragePaths(root).thumbnailsDir, `${assetId}.webp`)).catch(
      () => {},
    )
  }
}

/**
 * Permanently remove a soft-deleted asset (DB rows + file + thumbnail).
 * No-op / returns null if the asset is not in trash.
 */
export async function permanentlyDeleteTrashedAsset(
  prisma: PrismaClient,
  assetId: string,
): Promise<TrashAssetRow | null> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: { not: null } },
    include: {
      library: { select: { id: true, name: true, slug: true } },
      storageObject: true,
    },
  })
  if (!asset) return null

  const storageObjectId = asset.storageObjectId
  const physicalPath = asset.storageObject.physicalPath
  const objectKey = asset.storageObject.objectKey

  const instance = await prisma.instanceConfig.findFirst()
  const storageLocations = await prisma.storageLocation.findMany({
    select: { rootPath: true },
  })
  const extraRoots = storageLocations.map((s) => s.rootPath)

  await prisma.$transaction(async (tx) => {
    await tx.assetTag.deleteMany({ where: { assetId } })
    await tx.shareLinkAsset.deleteMany({ where: { assetId } })
    await tx.shareFeedback.deleteMany({ where: { assetId } })
    await tx.shareLink.deleteMany({ where: { assetId } })
    await tx.uploadSession.updateMany({
      where: { assetId },
      data: { assetId: null },
    })
    await tx.asset.delete({ where: { id: assetId } })

    const remaining = await tx.asset.count({ where: { storageObjectId } })
    if (remaining === 0) {
      await tx.storageObject.delete({ where: { id: storageObjectId } }).catch(() => {})
    }
  })

  await unlink(physicalPath).catch(() => {})
  // Also try object-key-relative candidates under known roots.
  for (const root of [instance?.storageRoot, apiConfig.dataDir, ...extraRoots]) {
    if (!root) continue
    const candidate = path.join(getStoragePaths(root).objectsDir, objectKey)
    if (candidate !== physicalPath) {
      await unlink(candidate).catch(() => {})
    }
  }

  await unlinkThumbnailCandidates(
    assetId,
    physicalPath,
    instance?.storageRoot,
    extraRoots,
  )

  return asset
}

export async function emptyTrash(prisma: PrismaClient): Promise<number> {
  const rows = await prisma.asset.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true },
  })
  let removed = 0
  for (const row of rows) {
    const deleted = await permanentlyDeleteTrashedAsset(prisma, row.id)
    if (deleted) removed += 1
  }
  return removed
}

/** Permanently remove trash items whose 30-day window has expired. */
export async function purgeExpiredTrash(prisma: PrismaClient): Promise<number> {
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - TRASH_RETENTION_DAYS)

  const expired = await prisma.asset.findMany({
    where: {
      deletedAt: { not: null, lte: cutoff },
    },
    select: { id: true },
  })

  let removed = 0
  for (const row of expired) {
    const deleted = await permanentlyDeleteTrashedAsset(prisma, row.id)
    if (deleted) removed += 1
  }
  return removed
}
