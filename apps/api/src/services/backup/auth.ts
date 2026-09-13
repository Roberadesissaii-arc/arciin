import {
  ARCIIN_SYNC_AUTHORIZATION_SCHEME,
  BACKUP_GRANT_LAST_USED_THROTTLE_MS,
} from "@arciin/config"
import type {
  Device,
  DeviceBackupGrant,
  DeviceBackupProfile,
  User,
} from "@prisma/client"
import type { FastifyReply, FastifyRequest } from "fastify"

import { hashToken } from "@/services/security/auth"

import { BackupError } from "./errors"

const SYNC_AUTH_RE = new RegExp(`^${ARCIIN_SYNC_AUTHORIZATION_SCHEME}\\s+(.+)$`, "i")

export type BackupGrantContext = {
  grant: DeviceBackupGrant
  profile: DeviceBackupProfile
  device: Device
  user: User
}

export function extractBackupAuthorization(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (typeof header !== "string") return null
  const match = header.match(SYNC_AUTH_RE)
  const value = match?.[1]?.trim()
  return value || null
}

export async function resolveBackupGrant(
  request: FastifyRequest,
): Promise<BackupGrantContext> {
  const raw = extractBackupAuthorization(request)
  if (!raw) {
    throw new BackupError(
      "BACKUP_CREDENTIAL_INVALID",
      "A computer-backup credential is required.",
      401,
    )
  }

  const grant = await request.server.prisma.deviceBackupGrant.findUnique({
    where: { credentialHash: hashToken(raw) },
    include: {
      profile: true,
      device: true,
      user: true,
    },
  })

  if (!grant || grant.revokedAt) {
    throw new BackupError("BACKUP_CREDENTIAL_INVALID", "Backup credential is invalid.", 401)
  }
  if (grant.device.status !== "ACTIVE" || grant.device.revokedAt) {
    throw new BackupError("BACKUP_DEVICE_UNPAIRED", "This device is no longer trusted.", 403)
  }
  if (grant.user.status !== "ACTIVE") {
    throw new BackupError("BACKUP_FORBIDDEN", "This account is not active.", 403)
  }
  if (grant.profile.status === "DISABLED") {
    throw new BackupError("BACKUP_DISABLED", "Computer backup is disabled for this device.", 403)
  }

  const now = Date.now()
  if (
    !grant.lastUsedAt ||
    now - grant.lastUsedAt.getTime() >= BACKUP_GRANT_LAST_USED_THROTTLE_MS
  ) {
    await request.server.prisma.deviceBackupGrant.update({
      where: { id: grant.id },
      data: { lastUsedAt: new Date() },
    })
  }

  return {
    grant,
    profile: grant.profile,
    device: grant.device,
    user: grant.user,
  }
}

export function requireBackupGrant() {
  return async function preHandler(request: FastifyRequest, reply: FastifyReply) {
    try {
      request.backupGrant = await resolveBackupGrant(request)
    } catch (error) {
      if (error instanceof BackupError) {
        reply.status(error.status).send({
          error: { code: error.code, message: error.message },
        })
        return
      }
      throw error
    }
  }
}

export function assertBackupOwner(
  actor: { id: string; role: string },
  userId: string,
) {
  if (actor.role === "OWNER" || actor.role === "ADMIN") return
  if (actor.id === userId) return
  throw new BackupError("BACKUP_FORBIDDEN", "You cannot access another user's backup.", 403)
}
