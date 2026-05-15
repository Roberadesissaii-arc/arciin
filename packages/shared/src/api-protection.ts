export type ApiProtectionSettings = {
  apiGlobalRequestsPerMinute: number
  apiKeyRequestsPerMinute: number
  requireApiKeyExpiry: boolean
  maxApiKeyExpiryDays: number
  ipAllowlist: string[]
  ipBlocklist: string[]
  enforceIpAllowlist: boolean
}

export const DEFAULT_API_PROTECTION: ApiProtectionSettings = {
  apiGlobalRequestsPerMinute: 0,
  apiKeyRequestsPerMinute: 0,
  requireApiKeyExpiry: false,
  maxApiKeyExpiryDays: 0,
  ipAllowlist: [],
  ipBlocklist: [],
  enforceIpAllowlist: false,
}

export function parseApiProtectionConfig(sec: unknown): ApiProtectionSettings {
  const s = sec && typeof sec === "object" ? (sec as Record<string, unknown>) : {}
  return {
    apiGlobalRequestsPerMinute: Number(s.apiGlobalRequestsPerMinute ?? 0),
    apiKeyRequestsPerMinute: Number(s.apiKeyRequestsPerMinute ?? 0),
    requireApiKeyExpiry: Boolean(s.requireApiKeyExpiry ?? false),
    maxApiKeyExpiryDays: Number(s.maxApiKeyExpiryDays ?? 0),
    ipAllowlist: Array.isArray(s.ipAllowlist) ? (s.ipAllowlist as string[]) : [],
    ipBlocklist: Array.isArray(s.ipBlocklist) ? (s.ipBlocklist as string[]) : [],
    enforceIpAllowlist: Boolean(s.enforceIpAllowlist ?? false),
  }
}

/** Normalize user-entered IP or CIDR for storage. */
export function normalizeIpRule(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  if (t.length > 120) return null
  // IPv4 with optional CIDR
  if (/^[\d./]+$/.test(t) && /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(t)) {
    return t
  }
  // IPv6 loose check
  if (/^[a-fA-F0-9:.]+$/.test(t) && t.includes(":")) {
    return t.toLowerCase()
  }
  return null
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map((p) => Number(p))
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0
}

function matchIpv4Cidr(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/")
  const bits = bitsStr ? Number(bitsStr) : 32
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
  const ipInt = ipv4ToInt(ip)
  const baseInt = ipv4ToInt(base!)
  if (ipInt === null || baseInt === null) return false
  if (bits === 0) return true
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0
  return (ipInt & mask) === (baseInt & mask)
}

export function ipMatchesRule(clientIp: string, rule: string): boolean {
  const r = rule.trim()
  if (!r) return false
  if (!r.includes("/")) {
    return clientIp === r
  }
  if (clientIp.includes(":")) return false
  return matchIpv4Cidr(clientIp, r)
}

/** Local loopback — always allowed so operators cannot lock themselves out on the same host. */
export function isLoopbackIp(clientIp: string): boolean {
  const ip = clientIp.trim()
  if (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1") return true
  if (ip.startsWith("127.")) return true
  return false
}

export function evaluateIpAccess(
  clientIp: string,
  settings: Pick<ApiProtectionSettings, "ipAllowlist" | "ipBlocklist" | "enforceIpAllowlist">,
): { allowed: boolean; reason?: string } {
  if (isLoopbackIp(clientIp)) {
    return { allowed: true }
  }

  const blocklist = settings.ipBlocklist.filter(Boolean)
  for (const rule of blocklist) {
    if (ipMatchesRule(clientIp, rule)) {
      return { allowed: false, reason: "ip_blocked" }
    }
  }

  if (settings.enforceIpAllowlist) {
    const allowlist = settings.ipAllowlist.filter(Boolean)
    // Misconfiguration: enforcing with zero entries must not block all traffic.
    if (allowlist.length === 0) {
      return { allowed: true }
    }
    const allowed = allowlist.some((rule) => ipMatchesRule(clientIp, rule))
    if (!allowed) {
      return { allowed: false, reason: "ip_not_allowlisted" }
    }
  }

  return { allowed: true }
}
