import { randomBytes } from "node:crypto"

import {
  DEVICE_CREDENTIAL_BYTES,
  DEVICE_LAST_SEEN_THROTTLE_MS,
  DEVICE_NAME_MAX_LENGTH,
  DEVICE_PAIRING_CODE_TTL_MS,
  DEVICE_PAIRING_MAX_ATTEMPTS,
  DEVICE_PLATFORMS,
  DEVICE_SESSION_TTL_MS,
  DEVICE_TYPES,
  type DevicePlatformInput,
  type DeviceTypeInput,
  generateDevicePairingCode,
  normalizeDevicePairingCode,
} from "@arciin/config"
import type { Device, DevicePlatform, DeviceType, Prisma, PrismaClient } from "@prisma/client"

import {
  generateOpaqueToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "@/services/security/auth"
import { revokeBackupGrantsForDevice } from "@/services/backup/profile"

export class DevicePairingError extends Error {
  constructor(
    public readonly code:
      | "PAIRING_CODE_INVALID"
      | "PAIRING_CODE_EXPIRED"
      | "PAIRING_CODE_LOCKED"
      | "PAIRING_ALREADY_USED"
      | "PAIRING_CANCELLED"
      | "DEVICE_REVOKED"
      | "DEVICE_INVALID"
      | "DEVICE_PROTOCOL_UNSUPPORTED"
      | "VALIDATION_ERROR",
    message: string,
    public readonly status = 401,
  ) {
    super(message)
    this.name = "DevicePairingError"
  }
}

function isTransactionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code = "code" in error ? String(error.code) : ""
  return code === "P2034" || code === "P2035"
}

export { generateDevicePairingCode }

export function generateDeviceCredential(): string {
  return randomBytes(DEVICE_CREDENTIAL_BYTES).toString("base64url")
}

export function hashDeviceCredential(credential: string): string {
  return hashToken(credential)
}

export function normalizeDeviceName(name: string): string {
  return name.trim().slice(0, DEVICE_NAME_MAX_LENGTH)
}

export function parseDevicePlatform(value: string): DevicePlatform {
  const key = value.trim().toLowerCase()
  if (!(DEVICE_PLATFORMS as readonly string[]).includes(key)) {
    throw new DevicePairingError(
      "VALIDATION_ERROR",
      "Unsupported device platform.",
      400,
    )
  }
  return key.toUpperCase() as DevicePlatform
}

export function parseDeviceType(value: string): DeviceType {
  const key = value.trim().toLowerCase()
  if (!(DEVICE_TYPES as readonly string[]).includes(key)) {
    throw new DevicePairingError("VALIDATION_ERROR", "Unsupported device type.", 400)
  }
  return key.toUpperCase() as DeviceType
}

export function assertSupportedProtocol(version: number): void {
  if (!Number.isInteger(version) || version !== 1) {
    throw new DevicePairingError(
      "DEVICE_PROTOCOL_UNSUPPORTED",
      "This server requires device protocol version 1.",
      400,
    )
  }
}

async function markExpiredPairings(prisma: PrismaClient | Prisma.TransactionClient) {
  await prisma.devicePairing.updateMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  })
}

export async function cancelPendingPairings(prisma: PrismaClient | Prisma.TransactionClient) {
  await markExpiredPairings(prisma)
  await prisma.devicePairing.updateMany({
    where: { status: "PENDING" },
    data: { status: "CANCELLED" },
  })
}

export async function createDevicePairing(
  prisma: PrismaClient,
  createdByUserId: string,
): Promise<{ id: string; code: string; expiresAt: Date }> {
  await cancelPendingPairings(prisma)

  const code = generateDevicePairingCode()
  const expiresAt = new Date(Date.now() + DEVICE_PAIRING_CODE_TTL_MS)
  const row = await prisma.devicePairing.create({
    data: {
      codeHash: await hashPassword(code),
      createdByUserId,
      expiresAt,
      status: "PENDING",
    },
  })
  return { id: row.id, code, expiresAt }
}

export async function getActiveDevicePairing(prisma: PrismaClient) {
  await markExpiredPairings(prisma)
  return prisma.devicePairing.findFirst({
    where: {
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  })
}

export type ClaimDeviceInput = {
  code: string
  name: string
  platform: DevicePlatformInput | string
  deviceType: DeviceTypeInput | string
  appVersion?: string
  protocolVersion: number
  osVersion?: string
  architecture?: string
}

export async function claimDevicePairing(
  prisma: PrismaClient,
  input: ClaimDeviceInput,
): Promise<{ device: Device; credential: string }> {
  assertSupportedProtocol(input.protocolVersion)

  const code = normalizeDevicePairingCode(input.code)
  if (!code) {
    throw new DevicePairingError(
      "PAIRING_CODE_INVALID",
      "Pairing code is invalid.",
    )
  }

  const name = normalizeDeviceName(input.name)
  if (!name) {
    throw new DevicePairingError("VALIDATION_ERROR", "Device name is required.", 400)
  }

  const platform = parseDevicePlatform(String(input.platform))
  const deviceType = parseDeviceType(String(input.deviceType))
  const credential = generateDeviceCredential()
  const credentialHash = hashDeviceCredential(credential)

  try {
    return await claimDevicePairingOnce(prisma, {
      code,
      name,
      platform,
      deviceType,
      credential,
      credentialHash,
      protocolVersion: input.protocolVersion,
      appVersion: input.appVersion,
      osVersion: input.osVersion,
      architecture: input.architecture,
    })
  } catch (error) {
    if (isTransactionConflict(error)) {
      throw new DevicePairingError(
        "PAIRING_ALREADY_USED",
        "Pairing code has already been used.",
      )
    }
    throw error
  }
}

async function claimDevicePairingOnce(
  prisma: PrismaClient,
  input: {
    code: string
    name: string
    platform: DevicePlatform
    deviceType: DeviceType
    credential: string
    credentialHash: string
    protocolVersion: number
    appVersion?: string
    osVersion?: string
    architecture?: string
  },
): Promise<{ device: Device; credential: string }> {
  const pairing = await prisma.devicePairing.findFirst({
    orderBy: { createdAt: "desc" },
  })

  if (!pairing) {
    throw new DevicePairingError("PAIRING_CODE_INVALID", "Pairing code is invalid.")
  }

  if (
    pairing.status === "EXPIRED" ||
    (pairing.status === "PENDING" && pairing.expiresAt <= new Date())
  ) {
    if (pairing.status === "PENDING") {
      await prisma.devicePairing.updateMany({
        where: { id: pairing.id, status: "PENDING" },
        data: { status: "EXPIRED" },
      })
    }
    throw new DevicePairingError("PAIRING_CODE_EXPIRED", "Pairing code has expired.")
  }

  if (pairing.status === "CLAIMED") {
    throw new DevicePairingError(
      "PAIRING_ALREADY_USED",
      "Pairing code has already been used.",
    )
  }

  if (pairing.status !== "PENDING") {
    throw new DevicePairingError("PAIRING_CODE_INVALID", "Pairing code is invalid.")
  }

  const matches = await verifyPassword(input.code, pairing.codeHash)
  if (!matches) {
    const bumped = await prisma.devicePairing.updateMany({
      where: { id: pairing.id, status: "PENDING" },
      data: { attemptCount: { increment: 1 } },
    })
    if (bumped.count !== 1) {
      throw new DevicePairingError("PAIRING_CODE_INVALID", "Pairing code is invalid.")
    }
    const current = await prisma.devicePairing.findUnique({ where: { id: pairing.id } })
    if (current && current.attemptCount >= DEVICE_PAIRING_MAX_ATTEMPTS) {
      await prisma.devicePairing.updateMany({
        where: { id: pairing.id, status: "PENDING" },
        data: { status: "CANCELLED" },
      })
      throw new DevicePairingError(
        "PAIRING_CODE_LOCKED",
        "Pairing code is no longer valid.",
      )
    }
    throw new DevicePairingError("PAIRING_CODE_INVALID", "Pairing code is invalid.")
  }

  return prisma.$transaction(
    async (tx) => {
      const claimed = await tx.devicePairing.updateMany({
        where: { id: pairing.id, status: "PENDING" },
        data: { status: "CLAIMED", claimedAt: new Date() },
      })
      if (claimed.count !== 1) {
        throw new DevicePairingError(
          "PAIRING_ALREADY_USED",
          "Pairing code has already been used.",
        )
      }

      const device = await tx.device.create({
        data: {
          name: input.name,
          platform: input.platform,
          deviceType: input.deviceType,
          status: "ACTIVE",
          credentialHash: input.credentialHash,
          protocolVersion: input.protocolVersion,
          appVersion: input.appVersion?.trim().slice(0, 40) || null,
          osVersion: input.osVersion?.trim().slice(0, 80) || null,
          architecture: input.architecture?.trim().slice(0, 32) || null,
          lastSeenAt: new Date(),
        },
      })

      await tx.devicePairing.update({
        where: { id: pairing.id },
        data: { claimedByDeviceId: device.id },
      })

      return { device, credential: input.credential }
    },
    { isolationLevel: "Serializable" },
  )
}

export async function findActiveDeviceByCredential(
  prisma: PrismaClient,
  credential: string,
): Promise<Device> {
  const trimmed = credential.trim()
  if (!trimmed) {
    throw new DevicePairingError("DEVICE_INVALID", "Device credential is invalid.")
  }

  const device = await prisma.device.findUnique({
    where: { credentialHash: hashDeviceCredential(trimmed) },
  })

  if (!device) {
    throw new DevicePairingError("DEVICE_INVALID", "Device credential is invalid.")
  }
  if (device.status === "REVOKED" || device.revokedAt) {
    throw new DevicePairingError("DEVICE_REVOKED", "This device is no longer trusted.")
  }
  return device
}

export async function touchDeviceLastSeen(
  prisma: PrismaClient,
  deviceId: string,
  lastSeenAt: Date | null,
): Promise<void> {
  const stale =
    !lastSeenAt || Date.now() - lastSeenAt.getTime() >= DEVICE_LAST_SEEN_THROTTLE_MS
  if (!stale) return
  await prisma.device
    .updateMany({
      where: { id: deviceId, status: "ACTIVE" },
      data: { lastSeenAt: new Date() },
    })
    .catch(() => {})
}

export async function issueDeviceSession(
  prisma: PrismaClient,
  device: Device,
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = generateOpaqueToken()
  const expiresAt = new Date(Date.now() + DEVICE_SESSION_TTL_MS)

  await prisma.deviceSession.deleteMany({
    where: {
      OR: [{ deviceId: device.id }, { expiresAt: { lt: new Date() } }],
    },
  })

  await prisma.deviceSession.create({
    data: {
      deviceId: device.id,
      tokenHash: hashToken(rawToken),
      expiresAt,
    },
  })

  await touchDeviceLastSeen(prisma, device.id, device.lastSeenAt)
  return { rawToken, expiresAt }
}

export async function resolveDeviceSessionToken(
  prisma: PrismaClient,
  rawToken: string,
): Promise<Device | null> {
  const trimmed = rawToken.trim()
  if (!trimmed) return null

  const row = await prisma.deviceSession.findUnique({
    where: { tokenHash: hashToken(trimmed) },
    include: { device: true },
  })
  if (!row || row.expiresAt <= new Date()) return null
  if (row.device.status !== "ACTIVE" || row.device.revokedAt) return null
  await touchDeviceLastSeen(prisma, row.device.id, row.device.lastSeenAt)
  return row.device
}

export async function revokeDevice(
  prisma: PrismaClient,
  deviceId: string,
): Promise<Device | null> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } })
  if (!device) return null
  if (device.status === "REVOKED") return device

  const now = new Date()
  const updated = await prisma.device.update({
    where: { id: device.id },
    data: { status: "REVOKED", revokedAt: now },
  })

  await prisma.deviceSession.deleteMany({ where: { deviceId: device.id } })
  await prisma.session.deleteMany({ where: { pairedDeviceId: device.id } })
  await revokeBackupGrantsForDevice(prisma, device.id)
  return updated
}

export async function renameDevice(
  prisma: PrismaClient,
  deviceId: string,
  name: string,
): Promise<Device | null> {
  const next = normalizeDeviceName(name)
  if (!next) {
    throw new DevicePairingError("VALIDATION_ERROR", "Device name is required.", 400)
  }
  const device = await prisma.device.findUnique({ where: { id: deviceId } })
  if (!device || device.status === "REVOKED") return null
  return prisma.device.update({
    where: { id: device.id },
    data: { name: next },
  })
}

export async function listActiveDevices(prisma: PrismaClient) {
  return prisma.device.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ lastSeenAt: "desc" }, { pairedAt: "desc" }],
  })
}
