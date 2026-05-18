import type { FastifyRequest } from "fastify"

const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/
const IPV6 =
  /^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i

/** Strip IPv6 zone id (e.g. fe80::1%en0 → fe80::1). */
function stripZoneId(value: string) {
  const zone = value.indexOf("%")
  return zone === -1 ? value : value.slice(0, zone)
}

/** Map IPv4-mapped IPv6 (::ffff:192.168.1.1) to dotted IPv4 when possible. */
function unwrapMappedIpv4(value: string): string {
  const lower = value.toLowerCase()
  if (lower.startsWith("::ffff:")) {
    const tail = value.slice(7)
    if (IPV4.test(tail)) return tail
  }
  return value
}

/** True when the string is a usable IP for blocklists and session display. */
export function isValidClientIp(value: string): boolean {
  const trimmed = stripZoneId(value.trim())
  if (!trimmed) return false
  const candidate = unwrapMappedIpv4(trimmed)
  if (IPV4.test(candidate)) return true
  if (IPV6.test(candidate)) return true
  return false
}

/** Normalize to a displayable IP; returns null for hostnames and garbage. */
export function normalizeClientIp(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = stripZoneId(raw.trim())
  if (!trimmed) return null
  const candidate = unwrapMappedIpv4(trimmed)
  if (isValidClientIp(candidate)) return candidate
  return null
}

export function clientIpFromRequest(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"]
  if (typeof forwarded === "string") {
    for (const part of forwarded.split(",")) {
      const normalized = normalizeClientIp(part)
      if (normalized) return normalized
    }
  }
  if (typeof forwarded === "object" && Array.isArray(forwarded)) {
    for (const part of forwarded) {
      const normalized = normalizeClientIp(part)
      if (normalized) return normalized
    }
  }

  const direct = normalizeClientIp(request.ip)
  if (direct) return direct

  const socket = request.socket?.remoteAddress
  const fromSocket = normalizeClientIp(socket)
  if (fromSocket) return fromSocket

  return request.ip?.trim() || "unknown"
}
