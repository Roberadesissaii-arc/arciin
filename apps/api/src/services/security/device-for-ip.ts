import { parseClientDeviceLabel } from "@arciin/shared"
import type { PrismaClient } from "@prisma/client"

import { normalizeClientIp } from "@/services/security/client-ip"

function deviceFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const meta = metadata as Record<string, unknown>
  const label = typeof meta.deviceLabel === "string" ? meta.deviceLabel.trim() : ""
  if (label) return label
  const ua = typeof meta.userAgent === "string" ? meta.userAgent : null
  return parseClientDeviceLabel(ua)
}

function ipFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const clientIp = (metadata as Record<string, unknown>).clientIp
  return typeof clientIp === "string" ? normalizeClientIp(clientIp) : null
}

/** Last known browser/OS label for an IP (sessions, then recent security/auth activity). */
export async function resolveDeviceLabelForIp(
  prisma: PrismaClient,
  rawIp: string,
): Promise<string | null> {
  const ip = normalizeClientIp(rawIp)
  if (!ip) return null

  const session = await prisma.session.findFirst({
    where: { ipAddress: ip },
    orderBy: { createdAt: "desc" },
    select: { userAgent: true },
  })
  const fromSession = parseClientDeviceLabel(session?.userAgent)
  if (fromSession) return fromSession

  const recent = await prisma.activityEvent.findMany({
    where: {
      OR: [{ type: { startsWith: "auth." } }, { type: { startsWith: "security." } }],
    },
    orderBy: { createdAt: "desc" },
    take: 400,
    select: { metadata: true },
  })

  for (const row of recent) {
    if (ipFromMetadata(row.metadata) !== ip) continue
    const label = deviceFromMetadata(row.metadata)
    if (label) return label
  }

  return null
}

export type SecurityLogRow = {
  id: string
  metadata: unknown
  [key: string]: unknown
}

/** Fill missing deviceLabel on security log rows using peer events + session history. */
export async function enrichSecurityLogDeviceLabels<T extends SecurityLogRow>(
  prisma: PrismaClient,
  rows: T[],
): Promise<T[]> {
  const ipToDevice = new Map<string, string>()

  for (const row of rows) {
    const ip = ipFromMetadata(row.metadata)
    const device = deviceFromMetadata(row.metadata)
    if (ip && device) ipToDevice.set(ip, device)
  }

  const ipsNeedingLookup = new Set<string>()
  for (const row of rows) {
    const ip = ipFromMetadata(row.metadata)
    if (ip && !ipToDevice.has(ip)) ipsNeedingLookup.add(ip)
  }

  await Promise.all(
    [...ipsNeedingLookup].map(async (ip) => {
      const device = await resolveDeviceLabelForIp(prisma, ip)
      if (device) ipToDevice.set(ip, device)
    }),
  )

  return rows.map((row) => {
    const ip = ipFromMetadata(row.metadata)
    const existing = deviceFromMetadata(row.metadata)
    if (!ip || existing) return row

    const device = ipToDevice.get(ip)
    if (!device) return row

    const meta =
      row.metadata && typeof row.metadata === "object"
        ? { ...(row.metadata as Record<string, unknown>) }
        : {}

    return {
      ...row,
      metadata: { ...meta, deviceLabel: device },
    }
  })
}
