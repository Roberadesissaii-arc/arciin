import http from "node:http"
import https from "node:https"
import net from "node:net"
import type { LookupAddress, LookupOptions } from "node:dns"
import { lookup as dnsLookup } from "node:dns"
import type { Readable } from "node:stream"

/**
 * SSRF-hardened HTTP client for URL imports.
 *
 * Threats closed here that a plain `fetch(url, { redirect: "follow" })` leaves open:
 *  - DNS rebinding: the hostname resolves to a public IP at check time but a
 *    private one at connect time. We validate inside the socket `lookup` hook,
 *    which runs at the moment of connection.
 *  - Redirect SSRF: a public URL 3xx-redirects to 169.254.169.254 / 10.x. We
 *    follow redirects manually and re-validate every hop's host + resolved IP.
 *  - Decompression bombs: we request identity encoding so a small gzip body
 *    cannot expand to gigabytes in memory.
 */

export function isPrivateOrReservedIp(ip: string): boolean {
  const family = net.isIP(ip)
  if (family === 4) {
    const [a, b] = ip.split(".").map(Number)
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a >= 224) return true // multicast + reserved
    return false
  }
  const low = ip.toLowerCase().replace(/^\[|\]$/g, "")
  if (low === "::1" || low === "::") return true
  if (low.startsWith("fe80:")) return true // link-local
  if (low.startsWith("fc") || low.startsWith("fd")) return true // unique-local
  if (low.startsWith("::ffff:")) {
    const mapped = low.slice(7)
    if (net.isIP(mapped) === 4) return isPrivateOrReservedIp(mapped)
    return true
  }
  return false
}

function hostIsBlockedName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  if (!host) return true
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true
  if (host === "metadata" || host === "metadata.google.internal") return true
  return false
}

/**
 * dns.lookup wrapper that rejects any private/reserved resolution. Passed as the
 * socket `lookup` option so validation happens at connect time (rebind-safe).
 *
 * Node's HTTP client may pass `options.all: true`, in which case the callback
 * must receive an array of addresses — not a single (address, family) pair.
 */
type HttpLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void

const validatedLookup = (
  hostname: string,
  options: LookupOptions,
  callback: HttpLookupCallback,
): void => {
  const wantsAll = Boolean(options.all)
  const familyHint =
    typeof options.family === "number"
      ? options.family
      : options.family === "IPv4"
        ? 4
        : options.family === "IPv6"
          ? 6
          : 4
  if (hostIsBlockedName(hostname)) {
    callback(new Error(`Blocked host: ${hostname}`) as NodeJS.ErrnoException, "", 0)
    return
  }

  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err || !addresses.length) {
      callback((err ?? new Error("DNS lookup failed")) as NodeJS.ErrnoException, "", 0)
      return
    }

    const safeAddresses = addresses.filter((entry) => !isPrivateOrReservedIp(entry.address))
    if (!safeAddresses.length) {
      callback(
        new Error(`Blocked: ${hostname} resolves only to private addresses.`) as NodeJS.ErrnoException,
        "",
        0,
      )
      return
    }

    if (wantsAll) {
      callback(null, safeAddresses)
      return
    }

    const preferred =
      safeAddresses.find((entry) => entry.family === familyHint) ?? safeAddresses[0]!
    callback(null, preferred.address, preferred.family)
  })
}

export type SafeResponse = {
  statusCode: number
  headers: http.IncomingHttpHeaders
  finalUrl: string
  stream: Readable
}

export type SafeRequestOptions = {
  maxRedirects?: number
  timeoutMs?: number
  userAgent?: string
  referer?: string
}

/** Perform one GET, validating the host at connect time. Does not follow redirects. */
function requestOnce(rawUrl: string, opts: Required<SafeRequestOptions>): Promise<SafeResponse> {
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      reject(new Error("Invalid URL."))
      return
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      reject(new Error("Only http(s) links can be imported."))
      return
    }
    if (hostIsBlockedName(url.hostname)) {
      reject(new Error("This link points at a local or private address."))
      return
    }
    // Literal-IP URLs never reach the DNS lookup hook — validate them directly.
    const literal = url.hostname.replace(/^\[|\]$/g, "")
    if (net.isIP(literal) && isPrivateOrReservedIp(literal)) {
      reject(new Error("This link points at a private address."))
      return
    }

    const transport = url.protocol === "https:" ? https : http
    const req = transport.request(
      url,
      {
        method: "GET",
        lookup: validatedLookup,
        headers: {
          "user-agent": opts.userAgent,
          accept: "*/*",
          // Disable compression: prevents decompression-bomb memory blowups.
          "accept-encoding": "identity",
          ...(opts.referer ? { referer: opts.referer } : {}),
        },
        timeout: opts.timeoutMs,
      },
      (res) => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          finalUrl: url.toString(),
          stream: res,
        })
      },
    )
    req.on("timeout", () => req.destroy(new Error("The link timed out.")))
    req.on("error", reject)
    req.end()
  })
}

/** GET a URL, manually following (and re-validating) up to `maxRedirects` hops. */
export async function safeRequest(
  rawUrl: string,
  options: SafeRequestOptions = {},
): Promise<SafeResponse> {
  const opts: Required<SafeRequestOptions> = {
    maxRedirects: options.maxRedirects ?? 4,
    timeoutMs: options.timeoutMs ?? 45_000,
    userAgent:
      options.userAgent ??
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    referer: options.referer ?? "",
  }

  let current = rawUrl
  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const res = await requestOnce(current, opts)
    const { statusCode, headers } = res
    if (statusCode >= 300 && statusCode < 400 && headers.location) {
      res.stream.resume() // drain and discard the redirect body
      let next: URL
      try {
        next = new URL(headers.location, current)
      } catch {
        throw new Error("The link redirected to an invalid location.")
      }
      current = next.toString()
      continue
    }
    return res
  }
  throw new Error("The link redirected too many times.")
}
