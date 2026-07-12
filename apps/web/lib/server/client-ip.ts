import "server-only"

const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/

function stripZoneId(value: string) {
  const zone = value.indexOf("%")
  return zone === -1 ? value : value.slice(0, zone)
}

function unwrapMappedIpv4(value: string): string {
  const lower = value.toLowerCase()
  if (lower.startsWith("::ffff:")) {
    const tail = value.slice(7)
    if (IPV4.test(tail)) return tail
  }
  return value
}

/** Normalize a client IP for upstream forwarding (IPv4 preferred when mapped). */
export function normalizeWebClientIp(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = stripZoneId(raw.trim())
  if (!trimmed) return null
  const candidate = unwrapMappedIpv4(trimmed)
  if (IPV4.test(candidate)) return candidate
  if (/^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i.test(candidate)) return candidate
  return null
}

/** Best-effort client IP from an incoming browser or edge request. */
export function clientIpFromIncomingRequest(request: Request): string | null {
  const cf = request.headers.get("cf-connecting-ip")?.trim()
  if (cf) {
    const normalized = normalizeWebClientIp(cf)
    if (normalized) return normalized
  }

  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) {
    const normalized = normalizeWebClientIp(realIp)
    if (normalized) return normalized
  }

  const xff = request.headers.get("x-forwarded-for")?.trim()
  if (xff) {
    for (const part of xff.split(",")) {
      const normalized = normalizeWebClientIp(part)
      if (normalized) return normalized
    }
  }

  return null
}
