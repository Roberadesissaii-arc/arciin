import type { PrismaClient } from "@prisma/client"

import { type ApiProtectionSettings, parseApiProtectionConfig } from "@arciin/shared"

let cached: { at: number; value: ApiProtectionSettings } | null = null
const CACHE_MS = 15_000

export async function loadApiProtectionSettings(prisma: PrismaClient): Promise<ApiProtectionSettings> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) {
    return cached.value
  }

  const instance = await prisma.instanceConfig.findFirst({
    select: { remoteAccessConfig: true },
  })
  const raw = (instance?.remoteAccessConfig as Record<string, unknown> | null) ?? {}
  const sec = raw.security
  const value = parseApiProtectionConfig(sec)
  cached = { at: now, value }
  return value
}

export function invalidateApiProtectionCache() {
  cached = null
}
