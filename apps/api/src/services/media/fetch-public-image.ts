/**
 * Fetching an image the server was told about by someone else.
 *
 * The image service hands back a URL and we fetch it, which is remote input
 * driving a server-side request. Checking the hostname before connecting is not
 * enough: a name that answered with a public address a moment ago can answer
 * with 127.0.0.1 on the next lookup, and the connection goes wherever DNS says
 * at the time it is made. That is DNS rebinding, and a string check cannot see
 * it.
 *
 * So the check happens *inside* the resolver, on the addresses actually being
 * connected to. `https.get` calls this lookup at connect time; if any answer is
 * private the connection never opens.
 */

import { lookup as dnsLookup } from "node:dns"
import { get as httpsGet } from "node:https"

/** Well above any cover art, well below something that would exhaust memory. */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const CONNECT_TIMEOUT_MS = 30_000

/**
 * Addresses no outbound image fetch has business reaching.
 *
 * Covers the cloud metadata endpoint, loopback, link-local, every private IPv4
 * range, and the IPv6 equivalents including v4-mapped forms — `::ffff:127.0.0.1`
 * is loopback wearing a different notation.
 */
export function isPublicAddress(address: string): boolean {
  const ip = address.trim().toLowerCase()
  if (!ip) return false

  // IPv6, including v4-mapped: unwrap and judge the v4 address inside.
  if (ip.includes(":")) {
    const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
    if (mapped) return isPublicAddress(mapped[1]!)
    if (ip === "::" || ip === "::1") return false
    if (/^(fe80|fc|fd)/.test(ip)) return false
    return true
  }

  const parts = ip.split(".").map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false
  }
  const [a, b] = parts as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 169 && b === 254) return false // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 100 && b >= 64 && b <= 127) return false // carrier-grade NAT
  if (a >= 224) return false // multicast and reserved
  return true
}

/**
 * Download an image over https, refusing anything that resolves inward.
 *
 * Redirects are not followed: a public URL that 302s to 169.254.169.254 is the
 * same attack wearing a hop, and an image service has no reason to redirect.
 */
export function fetchPublicImage(rawUrl: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      resolve(null)
      return
    }
    if (url.protocol !== "https:") {
      resolve(null)
      return
    }

    const request = httpsGet(
      url,
      {
        timeout: CONNECT_TIMEOUT_MS,
        // The whole defence. Called with the addresses this connection will
        // actually use, so a name that rebinds between checks is caught here
        // rather than having been waved through earlier.
        lookup: (hostname, options, callback) => {
          dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
            if (err) return callback(err, "", 0)
            const resolved = Array.isArray(addresses) ? addresses : [addresses]
            if (resolved.length === 0) {
              return callback(new Error("no address"), "", 0)
            }
            // Every answer must be public: picking the good one out of a mixed
            // reply leaves the attacker to decide which is used.
            for (const entry of resolved) {
              if (!isPublicAddress(entry.address)) {
                return callback(new Error("refusing a private address"), "", 0)
              }
            }
            return callback(null, resolved as never, undefined as never)
          })
        },
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume()
          resolve(null)
          return
        }
        const chunks: Buffer[] = []
        let total = 0
        response.on("data", (chunk: Buffer) => {
          total += chunk.length
          if (total > MAX_IMAGE_BYTES) {
            request.destroy()
            resolve(null)
            return
          }
          chunks.push(chunk)
        })
        response.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : null))
        response.on("error", () => resolve(null))
      },
    )

    request.on("timeout", () => {
      request.destroy()
      resolve(null)
    })
    request.on("error", () => resolve(null))
  })
}
