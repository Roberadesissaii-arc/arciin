import { isIP } from "node:net"
import { lookup } from "node:dns/promises"

/**
 * SSRF guard for URL imports.
 *
 * Two layers, because either alone is insufficient:
 *
 * 1. `isImportablePublicUrl` — synchronous, no I/O. Rejects non-http(s) schemes,
 *    internal-looking names, and literal addresses in private ranges. Cheap
 *    enough to run on the request path so an obviously bad URL never reaches a
 *    queue.
 * 2. `assertPublicUrlResolvesOffHost` — resolves DNS and checks *every* address
 *    the name maps to. A hostname is not an address, and `evil.example.com A
 *    127.0.0.1` passes any amount of string inspection.
 *
 * The previous version did only string inspection, and its IPv6 checks never
 * fired at all: `new URL("http://[::1]/").hostname` is `"[::1]"` — with the
 * brackets — so comparing against `"::1"` was always false. Addresses are
 * parsed here rather than pattern-matched.
 *
 * What this does not fully solve is DNS rebinding: a name can resolve to a
 * public address when checked and a private one when fetched. Re-validating
 * immediately before the fetch (and after each redirect) shrinks that window,
 * which is what the worker now does; closing it entirely needs the connection
 * pinned to the validated address, which the download tools we shell out to do
 * not expose.
 */

/** Hostnames that never refer to something on the public internet. */
const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"]
const BLOCKED_HOST_EXACT = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
])

function parseIpv4(value: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value)
  if (!match) return null
  const octets = match.slice(1, 5).map(Number)
  return octets.every((o) => o >= 0 && o <= 255) ? octets : null
}

function isBlockedIpv4(octets: number[]): boolean {
  const [a, b] = octets as [number, number, number, number]

  if (a === 0) return true // "this network"
  if (a === 10) return true // RFC1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 192 && b === 0 && octets[2] === 0) return true // IETF protocol assignments
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast + reserved + broadcast

  return false
}

/** Expand an IPv6 address to its 8 groups, or null when it is not parseable. */
function ipv6Groups(value: string): number[] | null {
  const [head, tail] = value.split("::", 2)
  const headParts = head ? head.split(":").filter(Boolean) : []
  const tailParts = tail !== undefined && tail ? tail.split(":").filter(Boolean) : []

  const parts = tail === undefined ? headParts : headParts
  if (tail === undefined && parts.length !== 8) return null

  const fill = 8 - headParts.length - tailParts.length
  if (tail !== undefined && fill < 0) return null

  const all =
    tail === undefined
      ? headParts
      : [...headParts, ...Array(fill).fill("0"), ...tailParts]

  const groups: number[] = []
  for (const part of all) {
    // An IPv4 tail (::ffff:127.0.0.1) is handled by the caller.
    if (part.includes(".")) return null
    const n = Number.parseInt(part, 16)
    if (Number.isNaN(n) || n < 0 || n > 0xffff) return null
    groups.push(n)
  }
  return groups.length === 8 ? groups : null
}

function isBlockedIpv6(raw: string): boolean {
  const value = raw.toLowerCase()

  // IPv4-mapped / -compatible: judge the embedded IPv4 address.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(value)
  if (mapped) {
    const octets = parseIpv4(mapped[1]!)
    return octets ? isBlockedIpv4(octets) : true
  }

  const groups = ipv6Groups(value)
  if (!groups) return true // unparseable — fail closed

  // ::ffff:7f00:1 is the normalized form of ::ffff:127.0.0.1
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const a = (groups[6]! >> 8) & 0xff
    const b = groups[6]! & 0xff
    const c = (groups[7]! >> 8) & 0xff
    const d = groups[7]! & 0xff
    return isBlockedIpv4([a, b, c, d])
  }

  if (groups.every((g) => g === 0)) return true // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true // ::1

  const first = groups[0]!
  if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((first & 0xff00) === 0xff00) return true // ff00::/8 multicast

  return false
}

/** Strip the brackets WHATWG URL keeps around an IPv6 hostname. */
export function normalizeHostname(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  if (host.startsWith("[") && host.endsWith("]")) return host.slice(1, -1)
  return host
}

/** True when this literal address must never be fetched. */
export function isBlockedAddress(address: string): boolean {
  const host = normalizeHostname(address)
  const version = isIP(host)

  if (version === 4) {
    const octets = parseIpv4(host)
    return octets ? isBlockedIpv4(octets) : true
  }
  if (version === 6) return isBlockedIpv6(host)

  return false
}

/**
 * First-line filter: scheme, obviously-internal names, and literal addresses.
 * Does no DNS — see assertPublicUrlResolvesOffHost for that.
 */
export function isImportablePublicUrl(rawUrl: string): boolean {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false

  const host = normalizeHostname(url.hostname)
  if (!host) return false

  if (BLOCKED_HOST_EXACT.has(host)) return false
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false

  // Node's URL parser already folds 2130706433, 0x7f000001 and 0177.0.0.1 into
  // dotted-quad form, so the numeric checks below see all of them.
  if (isBlockedAddress(host)) return false

  return true
}

export class BlockedImportUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BlockedImportUrlError"
  }
}

/**
 * Resolve the hostname and reject if *any* address is internal.
 *
 * Any, not the first: a name with both a public and a private A record must not
 * be importable on the strength of whichever came back first.
 */
export async function assertPublicUrlResolvesOffHost(rawUrl: string): Promise<void> {
  if (!isImportablePublicUrl(rawUrl)) {
    throw new BlockedImportUrlError("That link points at a private or non-web address.")
  }

  const host = normalizeHostname(new URL(rawUrl).hostname)

  // Already a literal address — isImportablePublicUrl checked it directly.
  if (isIP(host) !== 0) return

  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(host, { all: true })
  } catch {
    throw new BlockedImportUrlError(`Could not resolve ${host}.`)
  }

  if (addresses.length === 0) {
    throw new BlockedImportUrlError(`Could not resolve ${host}.`)
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new BlockedImportUrlError(
        "That link resolves to an address on this server's private network.",
      )
    }
  }
}
