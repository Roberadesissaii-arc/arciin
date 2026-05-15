import type { PrismaClient } from "@prisma/client"

import { type AccessControlSettings, parseAccessControlConfig } from "@arciin/shared"

let cached: { at: number; value: AccessControlSettings } | null = null
const CACHE_MS = 15_000

export async function loadAccessControlSettings(prisma: PrismaClient): Promise<AccessControlSettings> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) {
    return cached.value
  }

  const instance = await prisma.instanceConfig.findFirst({
    select: { remoteAccessConfig: true },
  })
  const raw = (instance?.remoteAccessConfig as Record<string, unknown> | null) ?? {}
  const value = parseAccessControlConfig(raw.security)
  cached = { at: now, value }
  return value
}

export function invalidateAccessControlCache() {
  cached = null
}
