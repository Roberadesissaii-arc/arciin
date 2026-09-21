import type { PrismaClient } from "@prisma/client"

import { ARCIIN_AI_DESKTOP_TOOLS_PROTOCOL_VERSION } from "@arciin/config"
import { allDesktopToolsWithheld } from "@arciin/shared"

import { getDesktopToolHub } from "./hub"

export async function userOwnsPairedDevice(
  prisma: PrismaClient,
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const device = await prisma.device.findFirst({
    where: { id: deviceId, status: "ACTIVE" },
    select: { id: true },
  })
  if (!device) return false

  const [pairing, boundSession, backup] = await Promise.all([
    prisma.devicePairing.findFirst({
      where: { claimedByDeviceId: deviceId, createdByUserId: userId },
      select: { id: true },
    }),
    prisma.session.findFirst({
      where: { userId, pairedDeviceId: deviceId, expiresAt: { gt: new Date() } },
      select: { id: true },
    }),
    prisma.deviceBackupProfile.findFirst({
      where: { userId, deviceId },
      select: { id: true },
    }),
  ])

  return Boolean(pairing || boundSession || backup)
}

export type DesktopChatGate = {
  expose: boolean
  deviceId: string | null
  withheldTools: Set<string>
  reason:
    | "ok"
    | "disabled"
    | "security_off"
    | "device_unowned"
    | "device_inactive"
    | "unsupported"
}

export async function resolveDesktopChatGate(input: {
  prisma: PrismaClient
  userId: string
  desktopComputerAccess: "off" | "metadata_only"
  desktopContext?: { enabled: boolean; deviceId: string } | null
}): Promise<DesktopChatGate> {
  const withheld = allDesktopToolsWithheld()
  if (!input.desktopContext?.enabled || !input.desktopContext.deviceId) {
    return { expose: false, deviceId: null, withheldTools: withheld, reason: "disabled" }
  }
  if (input.desktopComputerAccess !== "metadata_only") {
    return { expose: false, deviceId: null, withheldTools: withheld, reason: "security_off" }
  }

  const deviceId = input.desktopContext.deviceId
  const owns = await userOwnsPairedDevice(input.prisma, input.userId, deviceId)
  if (!owns) {
    return { expose: false, deviceId: null, withheldTools: withheld, reason: "device_unowned" }
  }

  const hub = getDesktopToolHub()
  if (hub.isConnected(deviceId)) {
    const version = hub.protocolVersion(deviceId)
    if (version !== ARCIIN_AI_DESKTOP_TOOLS_PROTOCOL_VERSION) {
      return { expose: false, deviceId: null, withheldTools: withheld, reason: "unsupported" }
    }
  }

  return { expose: true, deviceId, withheldTools: new Set(), reason: "ok" }
}
