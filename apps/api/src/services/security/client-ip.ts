import type { FastifyRequest } from "fastify"

/** Set by the Next.js API proxy on loopback hops (see apps/web/lib/server/api-proxy.ts). */
export const ARCIIN_CLIENT_IP_HEADER = "x-arciin-client-ip"

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

function isLoopbackPeer(remoteAddress: string | null | undefined): boolean {
  const peer = normalizeClientIp(remoteAddress)
  return peer === "127.0.0.1" || peer === "::1"
}

export function clientIpFromRequest(request: FastifyRequest): string {
  const peer = normalizeClientIp(request.socket?.remoteAddress)

  // Next.js proxies /api on loopback and sets this header after resolving the
  // real browser IP. Only trust it from loopback peers so LAN clients cannot
  // forge it by hitting :4000 directly.
  const arciinHeader = request.headers[ARCIIN_CLIENT_IP_HEADER]
  if (isLoopbackPeer(peer) && typeof arciinHeader === "string") {
    const fromArciin = normalizeClientIp(arciinHeader)
    if (fromArciin) return fromArciin
  }

  // request.ip already honors the configured trustProxy setting: Fastify walks
  // X-Forwarded-For from the socket peer inward and stops at the first
  // *untrusted* hop, so a client cannot forge an IP past the edge proxy. Do
  // NOT re-parse the raw header here — that reintroduces the spoofing vector.
  const direct = normalizeClientIp(request.ip)
  if (direct) return direct

  const fromSocket = normalizeClientIp(request.socket?.remoteAddress)
  if (fromSocket) return fromSocket

  return request.ip?.trim() || "unknown"
}
