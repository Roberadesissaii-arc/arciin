import { randomBytes } from "node:crypto"

import type { Asset, Folder, ShareLink, ShareResourceType } from "@prisma/client"
import type { FastifyInstance } from "fastify"

import { hashToken } from "@/services/security/auth"
import { recordAndBroadcastActivity } from "@/services/activity/record-and-broadcast-activity"

export function generateShareToken() {
  const rawToken = `shr_${randomBytes(24).toString("base64url")}`
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    tokenPrefix: rawToken.slice(0, 12),
  }
}

export type ResolvedShareLink = ShareLink & {
  asset: (Asset & { library: { slug: string } }) | null
  folder: Folder | null
  shareAssets?: { assetId: string; sortOrder: number }[]
}

export async function resolveShareByToken(
  fastify: FastifyInstance,
  rawToken: string,
): Promise<
  | { ok: true; share: ResolvedShareLink }
  | { ok: false; code: "NOT_FOUND" | "REVOKED" | "EXPIRED" | "VIEW_LIMIT" }
> {
  const tokenHash = hashToken(rawToken.trim())
  const share = await fastify.prisma.shareLink.findUnique({
    where: { tokenHash },
    include: {
      asset: {
        include: {
          library: { select: { slug: true } },
        },
      },
      folder: true,
    },
  })

  if (!share) {
    return { ok: false, code: "NOT_FOUND" }
  }

  if (share.revokedAt) {
    return { ok: false, code: "REVOKED" }
  }

  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
    return { ok: false, code: "EXPIRED" }
  }

  if (share.maxViews != null && share.viewCount >= share.maxViews) {
    return { ok: false, code: "VIEW_LIMIT" }
  }

  return { ok: true, share }
}

export function folderWithinShareRoot(folder: Folder, root: Folder) {
  if (folder.libraryId !== root.libraryId) return false
  if (folder.id === root.id) return true
  return folder.pathCache.startsWith(`${root.pathCache}/`)
}

export async function assertAssetInShareScope(
  fastify: FastifyInstance,
  share: ResolvedShareLink,
  assetId: string,
): Promise<(Asset & { storageObject: { physicalPath: string; objectKey: string; mimeType: string }; library: { storageLocation: { rootPath: string } } }) | null> {
  const asset = await fastify.prisma.asset.findUnique({
    where: { id: assetId },
    include: {
      storageObject: true,
      library: { select: { storageLocation: { select: { rootPath: true } } } },
      folder: true,
    },
  })

  if (!asset || asset.deletedAt || asset.status === "DELETED") {
    return null
  }

  if (share.resourceType === "ASSET") {
    return share.assetId === asset.id ? asset : null
  }

  if (share.resourceType === "ASSETS") {
    const member = await fastify.prisma.shareLinkAsset.findFirst({
      where: { shareLinkId: share.id, assetId },
    })
    return member ? asset : null
  }

  if (!share.folder || !share.folderId) {
    return null
  }

  if (asset.libraryId !== share.folder.libraryId) {
    return null
  }

  if (asset.folderId === share.folderId) {
    return asset
  }

  if (asset.folder && folderWithinShareRoot(asset.folder, share.folder)) {
    return asset
  }

  return null
}

export async function assertFolderInShareScope(
  fastify: FastifyInstance,
  share: ResolvedShareLink,
  folderId: string,
): Promise<Folder | null> {
  if (share.resourceType !== "FOLDER" || !share.folder || !share.folderId) {
    return null
  }

  const folder = await fastify.prisma.folder.findUnique({
    where: { id: folderId },
  })

  if (!folder || folder.deletedAt) {
    return null
  }

  if (!folderWithinShareRoot(folder, share.folder)) {
    return null
  }

  return folder
}

export function serializePublicAsset(asset: Asset) {
  return {
    id: asset.id,
    originalFilename: asset.originalFilename,
    title: asset.title,
    mimeType: asset.mimeType,
    mediaType: asset.mediaType,
    extension: asset.extension,
    sizeBytes: Number(asset.sizeBytes),
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    status: asset.status,
    updatedAt: asset.updatedAt.toISOString(),
  }
}

export function serializePublicFolder(folder: Folder, assetCount: number) {
  return {
    id: folder.id,
    name: folder.name,
    slug: folder.slug,
    assetCount,
  }
}

export async function recordShareView(fastify: FastifyInstance, shareId: string) {
  await fastify.prisma.shareLink.update({
    where: { id: shareId },
    data: {
      viewCount: { increment: 1 },
      lastViewedAt: new Date(),
    },
  })
}

export async function recordShareFeedback(
  fastify: FastifyInstance,
  share: ResolvedShareLink,
  sentiment: "LIKE" | "DISLIKE",
  assetId?: string,
) {
  let assetLabel: string | undefined

  if (assetId) {
    const asset = await assertAssetInShareScope(fastify, share, assetId)
    if (!asset) {
      return { ok: false as const, code: "ASSET_NOT_FOUND" as const }
    }
    assetLabel = asset.title?.trim() || asset.originalFilename
  }

  await fastify.prisma.shareFeedback.create({
    data: {
      shareLinkId: share.id,
      assetId: assetId ?? null,
      sentiment,
    },
  })

  const liked = sentiment === "LIKE"
  const action = liked ? "liked" : "disliked"
  const message = assetLabel
    ? `Someone ${action} “${assetLabel}” from a share link.`
    : `Someone ${action} a share link.`

  await recordAndBroadcastActivity(fastify, {
    userId: share.createdById,
    type: "share.feedback",
    title: assetLabel
      ? liked
        ? "File liked"
        : "File disliked"
      : liked
        ? "Share liked"
        : "Share disliked",
    message,
    entityType: "share",
    entityId: share.id,
    metadata: {
      sentiment,
      assetId: assetId ?? null,
      assetLabel: assetLabel ?? null,
    },
  })

  return { ok: true as const }
}

export function shareResourceLabel(
  resourceType: ShareResourceType,
  asset: Asset | null,
  folder: Folder | null,
  assetCount?: number,
) {
  if (resourceType === "ASSET" && asset) {
    return asset.title?.trim() || asset.originalFilename
  }
  if (resourceType === "ASSETS" && assetCount != null) {
    return assetCount === 1 ? "1 file" : `${assetCount} files`
  }
  if (resourceType === "FOLDER" && folder) {
    return folder.name
  }
  return "Shared item"
}
