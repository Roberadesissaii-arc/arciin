import path from "node:path"
import { unlink } from "node:fs/promises"

import type { Prisma, PrismaClient } from "@prisma/client"

import { apiConfig } from "@/config"
import { verifyPassword } from "@/services/security/auth"
import { getStoragePaths } from "@/services/storage/local-storage"

export class ClearInstanceContentError extends Error {
  constructor(
    message: string,
    public code: "INVALID_PASSWORD" | "NOTHING_SELECTED" | "CLEAR_FAILED" = "CLEAR_FAILED",
  ) {
    super(message)
    this.name = "ClearInstanceContentError"
  }
}

export type ClearInstanceContentOptions = {
  clearChat: boolean
  clearMedia: boolean
  clearAppData: boolean
}

async function deleteAllLibraryFolders(tx: Prisma.TransactionClient) {
  for (let i = 0; i < 10_000; i++) {
    const res = await tx.folder.deleteMany({
      where: { childFolders: { none: {} } },
    })
    if (res.count === 0) break
  }
}

function isPathUnderAnyRoot(filePath: string, roots: string[]): boolean {
  const resolved = path.resolve(filePath)
  return roots.some((r) => {
    const root = path.resolve(r)
    return resolved === root || resolved.startsWith(root + path.sep)
  })
}

/**
 * Removes selected user-generated content (chat, library files/metadata, optional app databases).
 * Keeps users, sessions, libraries, storage locations, integrations, and model profiles.
 */
export async function clearInstanceContent(
  prisma: PrismaClient,
  actorUserId: string,
  password: string,
  opts: ClearInstanceContentOptions,
): Promise<void> {
  if (!opts.clearChat && !opts.clearMedia && !opts.clearAppData) {
    throw new ClearInstanceContentError("Select at least one category to clear.", "NOTHING_SELECTED")
  }

  const actor = await prisma.user.findUnique({ where: { id: actorUserId } })
  if (!actor || !(await verifyPassword(password, actor.passwordHash))) {
    throw new ClearInstanceContentError("Password is incorrect.", "INVALID_PASSWORD")
  }

  const instance = await prisma.instanceConfig.findFirst()
  if (!instance) {
    throw new ClearInstanceContentError("Instance not initialized.", "CLEAR_FAILED")
  }

  const storageLocations = await prisma.storageLocation.findMany({
    select: { rootPath: true },
  })

  const allowedRoots = [
    path.resolve(instance.storageRoot),
    ...storageLocations.map((s) => path.resolve(s.rootPath)),
    path.resolve(apiConfig.dataDir),
  ]

  let objectPaths: string[] = []
  let assetIds: string[] = []

  if (opts.clearMedia) {
    const objs = await prisma.storageObject.findMany({ select: { physicalPath: true } })
    objectPaths = objs.map((o) => o.physicalPath)
    const assets = await prisma.asset.findMany({ select: { id: true } })
    assetIds = assets.map((a) => a.id)
  }

  const thumbnailDirs = new Set<string>()
  thumbnailDirs.add(getStoragePaths(instance.storageRoot).thumbnailsDir)
  thumbnailDirs.add(getStoragePaths(apiConfig.dataDir).thumbnailsDir)
  for (const loc of storageLocations) {
    thumbnailDirs.add(getStoragePaths(loc.rootPath).thumbnailsDir)
  }

  try {
    await prisma.$transaction(
      async (tx) => {
        if (opts.clearChat) {
          await tx.chatConversation.deleteMany()
        }
        if (opts.clearAppData) {
          await tx.appDatabase.deleteMany()
        }
        if (opts.clearMedia) {
          await tx.uploadSession.deleteMany()
          await tx.assetTag.deleteMany()
          await tx.asset.deleteMany()
          await deleteAllLibraryFolders(tx)
          await tx.storageObject.deleteMany()
          await tx.tag.deleteMany()
          await tx.job.deleteMany()
          await tx.activityEvent.deleteMany()
        }
      },
      { maxWait: 30_000, timeout: 120_000 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database transaction failed."
    throw new ClearInstanceContentError(message, "CLEAR_FAILED")
  }

  if (opts.clearMedia) {
    for (const p of objectPaths) {
      if (!isPathUnderAnyRoot(p, allowedRoots)) continue
      await unlink(p).catch(() => {})
    }
    for (const assetId of assetIds) {
      for (const dir of thumbnailDirs) {
        await unlink(path.join(dir, `${assetId}.webp`)).catch(() => {})
      }
    }
  }

  const parts: string[] = []
  if (opts.clearChat) parts.push("chat")
  if (opts.clearMedia) parts.push("media & activity")
  if (opts.clearAppData) parts.push("app databases")

  await prisma.activityEvent.create({
    data: {
      userId: actorUserId,
      type: "instance.content_cleared",
      title: "Instance data cleared",
      message: `${actor.name} cleared: ${parts.join(", ")}.`,
    },
  })
}
