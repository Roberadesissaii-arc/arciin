import type { PrismaClient } from "@prisma/client"
import type { FastifyReply } from "fastify"

import { BackupError } from "./errors"

const READ_ONLY_MESSAGE =
  "Computer-backup files keep their source hierarchy in V1. Rename, move, or folder edits here do not change the computer, and the server copy cannot be reorganized from this view."

export async function isComputerLibrary(
  prisma: PrismaClient,
  libraryId: string,
): Promise<boolean> {
  const library = await prisma.library.findUnique({
    where: { id: libraryId },
    select: { kind: true },
  })
  return library?.kind === "COMPUTER"
}

export async function hasActiveSyncEntry(
  prisma: PrismaClient,
  assetId: string,
): Promise<boolean> {
  const entry = await prisma.syncEntry.findFirst({
    where: { assetId, syncState: "ACTIVE" },
    select: { id: true },
  })
  return Boolean(entry)
}

export async function rejectComputerFolderMutation(
  prisma: PrismaClient,
  reply: FastifyReply,
  libraryId: string,
): Promise<boolean> {
  if (!(await isComputerLibrary(prisma, libraryId))) return false
  reply.status(409).send({
    error: {
      code: "BACKUP_READ_ONLY",
      message: READ_ONLY_MESSAGE,
    },
  })
  return true
}

export async function rejectSyncedAssetHierarchyChange(
  prisma: PrismaClient,
  reply: FastifyReply,
  assetId: string,
): Promise<boolean> {
  if (!(await hasActiveSyncEntry(prisma, assetId))) return false
  reply.status(409).send({
    error: {
      code: "BACKUP_READ_ONLY",
      message: READ_ONLY_MESSAGE,
    },
  })
  return true
}

export function backupReadOnlyError() {
  return new BackupError("BACKUP_READ_ONLY", READ_ONLY_MESSAGE, 409)
}
