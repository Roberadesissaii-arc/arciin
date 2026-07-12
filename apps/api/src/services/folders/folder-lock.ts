import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

import { verifyPassword } from "@/services/security/auth"
import { readPasswordVaultPinHash, verifyVaultPin } from "@/services/password-vault/pin"
import {
  FOLDER_UNLOCK_TTL_MS,
  isFolderAccessGranted,
  issueFolderUnlock,
  readSessionFolderUnlocks,
  sessionFolderUnlocksToJson,
} from "@/services/folders/folder-unlock-store"

export async function verifyFolderAccessCredential(
  fastify: FastifyInstance,
  userId: string,
  body: { password?: string; pin?: string },
  aiConfig: unknown,
): Promise<{ ok: true } | { ok: false; code: "INVALID_PIN" | "INVALID_PASSWORD" }> {
  if (body.pin) {
    const pinHash = readPasswordVaultPinHash(aiConfig)
    if (!pinHash || !(await verifyVaultPin(body.pin, pinHash))) {
      return { ok: false, code: "INVALID_PIN" }
    }
    return { ok: true }
  }

  const user = await fastify.prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  })
  if (!user?.passwordHash || !(await verifyPassword(body.password!, user.passwordHash))) {
    return { ok: false, code: "INVALID_PASSWORD" }
  }
  return { ok: true }
}

export function folderIsLocked(folder: { lockedAt: Date | null }): boolean {
  return folder.lockedAt != null
}

export function folderAccessGranted(
  request: FastifyRequest,
  userId: string,
  folder: { id: string; lockedAt: Date | null },
  session?: { userId: string; folderUnlocks?: unknown } | null,
): boolean {
  if (!folderIsLocked(folder)) return true
  return isFolderAccessGranted(request, userId, folder.id, session)
}

export async function assertFolderAccess(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  folderId: string,
): Promise<{ id: string; lockedAt: Date | null; libraryId: string } | null> {
  const folder = await fastify.prisma.folder.findUnique({
    where: { id: folderId },
    select: { id: true, lockedAt: true, libraryId: true, deletedAt: true },
  })

  if (!folder || folder.deletedAt) {
    reply.status(404).send({
      error: { code: "FOLDER_NOT_FOUND", message: "Folder not found." },
    })
    return null
  }

  const userId = request.auth?.user.id
  if (!userId) {
    reply.status(401).send({
      error: { code: "UNAUTHORIZED", message: "Authentication required." },
    })
    return null
  }

  if (!folderAccessGranted(request, userId, folder, request.auth?.session ?? null)) {
    reply.status(403).send({
      error: {
        code: "FOLDER_LOCKED",
        message: "This folder is locked. Enter your account password or vault PIN to open it.",
      },
    })
    return null
  }

  return folder
}

/** Enforce folder lock when an asset lives inside a locked folder. */
export async function assertAssetFolderAccess(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  folderId: string | null | undefined,
): Promise<boolean> {
  if (!folderId) return true
  const allowed = await assertFolderAccess(fastify, request, reply, folderId)
  return allowed !== null
}

export async function grantFolderSessionAccess(
  fastify: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  folderId: string,
): Promise<void> {
  const cookieMap = issueFolderUnlock(reply, request, userId, folderId)

  const sessionId = request.auth?.session?.id
  if (sessionId) {
    const sessionMap = readSessionFolderUnlocks(request.auth?.session ?? null)
    sessionMap[folderId] = cookieMap[folderId] ?? Date.now() + FOLDER_UNLOCK_TTL_MS
    await fastify.prisma.session.update({
      where: { id: sessionId },
      data: { folderUnlocks: sessionFolderUnlocksToJson(sessionMap) },
    })
  }
}
