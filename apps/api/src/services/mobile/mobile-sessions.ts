import { MOBILE_SESSION_USER_AGENT_PREFIX } from "@arciin/shared"
import type { PrismaClient } from "@prisma/client"

import { normalizeClientIp } from "@/services/security/client-ip"

export type MobileConnectedDeviceRow = {
  id: string
  userId: string
  userName: string
  userEmail: string
  deviceName: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: string
  expiresAt: string
}

export function parseMobileDeviceName(userAgent: string | null): string {
  if (!userAgent) return "Mobile device"
  const prefix = `${MOBILE_SESSION_USER_AGENT_PREFIX} ·`
  if (userAgent.startsWith(prefix)) {
    const name = userAgent.slice(prefix.length).trim()
    return name || "Mobile"
  }
  if (userAgent.startsWith(MOBILE_SESSION_USER_AGENT_PREFIX)) {
    return userAgent.slice(MOBILE_SESSION_USER_AGENT_PREFIX.length).trim() || "Mobile"
  }
  return "Mobile device"
}

export async function listMobileConnectedDevices(
  prisma: PrismaClient,
): Promise<MobileConnectedDeviceRow[]> {
  const sessions = await prisma.session.findMany({
    where: {
      expiresAt: { gt: new Date() },
      userAgent: { startsWith: MOBILE_SESSION_USER_AGENT_PREFIX },
    },
    include: {
      user: {
        select: { id: true, name: true, email: true, status: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return sessions
    .filter((s) => s.user.status === "ACTIVE")
    .map((s) => ({
      id: s.id,
      userId: s.user.id,
      userName: s.user.name,
      userEmail: s.user.email,
      deviceName: parseMobileDeviceName(s.userAgent),
      userAgent: s.userAgent,
      ipAddress: normalizeClientIp(s.ipAddress),
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
    }))
}

export async function revokeMobileConnectedDevice(prisma: PrismaClient, sessionId: string) {
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      expiresAt: { gt: new Date() },
      userAgent: { startsWith: MOBILE_SESSION_USER_AGENT_PREFIX },
    },
    include: { user: { select: { id: true, name: true } } },
  })

  if (!session) return null

  await prisma.session.delete({ where: { id: sessionId } })
  return session
}
