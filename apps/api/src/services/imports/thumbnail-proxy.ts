/**
 * Fetching an import candidate's thumbnail for the browser.
 *
 * The thumbnail URL came from a page or from yt-dlp — attacker-controlled
 * input driving a server-side request — so the browser never sees it and the
 * server fetches it under the same rules as any import:
 *
 *  - https only, no credentials in the URL, default port only;
 *  - every address the connection uses must be public: checked inside the
 *    resolver (so DNS rebinding is caught at connect time) and, because Node
 *    skips the resolver for an IP literal, checked on the literal too;
 *  - redirects are followed by hand, at most MAX_REDIRECTS, and each hop is
 *    checked exactly like the first;
 *  - a short deadline for the whole exchange, a byte cap enforced while
 *    reading, an image MIME allowlist *and* a magic-byte check — a server
 *    calling HTML "image/png" is refused;
 *  - no cookies, no Authorization, no forwarded headers of any kind.
 */

import { lookup as dnsLookup, type LookupAddress } from "node:dns"
import type { IncomingMessage, RequestOptions } from "node:http"
import { get as httpsGet } from "node:https"
import { isIP } from "node:net"

// Relative so the unit suite (whose "@/" is the web app) can load this module.
import { isPublicAddress } from "../media/fetch-public-image"

export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024
export const THUMBNAIL_TIMEOUT_MS = 6_000
export const THUMBNAIL_MAX_REDIRECTS = 3

export const THUMBNAIL_MIME_ALLOWLIST = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const
export type ThumbnailMime = (typeof THUMBNAIL_MIME_ALLOWLIST)[number]

export type ThumbnailFailure =
  | "invalid_url"
  | "blocked"
  | "timeout"
  | "http_error"
  | "not_image"
  | "too_large"
  | "too_many_redirects"
  | "network"

export type ThumbnailResult = { ok: true; body: Buffer; contentType: ThumbnailMime } | { ok: false; reason: ThumbnailFailure }

type LookupFn = (
  hostname: string,
  options: { all: true; family?: number },
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void

export type ThumbnailFetchDeps = {
  /** HTTPS transport; replaced in tests. */
  get?: (url: URL, options: RequestOptions, callback: (res: IncomingMessage) => void) => { on: (event: string, fn: (...args: unknown[]) => void) => unknown; destroy: (err?: Error) => void }
  /** DNS resolver used by the transport's `lookup`; replaced in tests. */
  resolve?: LookupFn
  timeoutMs?: number
  maxBytes?: number
}

/** The URL itself: https, public-looking host, no userinfo, default port. Null when refused. */
export function acceptableThumbnailUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "https:") return null
  if (url.username || url.password) return null
  if (url.port && url.port !== "443") return null
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "")
  if (!host) return null
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null
  // An IP literal never reaches the resolver, so it is judged here.
  if (isIP(host) && !isPublicAddress(host)) return null
  if (!isIP(host) && !host.includes(".")) return null
  return url
}

/** The image type the bytes actually are, from their signature. */
export function sniffImageType(head: Buffer): ThumbnailMime | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg"
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
  if (head.length >= 6 && /^GIF8[79]a$/.test(head.subarray(0, 6).toString("latin1"))) return "image/gif"
  if (head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp"
  if (head.length >= 12 && head.subarray(4, 8).toString("latin1") === "ftyp" && /^avi[fs]$/.test(head.subarray(8, 12).toString("latin1"))) return "image/avif"
  return null
}

function declaredMime(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header
  return (value ?? "").split(";")[0]!.trim().toLowerCase()
}

const defaultResolve: LookupFn = (hostname, options, callback) =>
  dnsLookup(hostname, options, (err, addresses) => callback(err, (Array.isArray(addresses) ? addresses : []) as LookupAddress[]))

/** One GET, no redirect handling. Resolves with the response or a failure. */
function requestOnce(
  url: URL,
  deps: Required<Pick<ThumbnailFetchDeps, "get" | "resolve">>,
  signal: { timedOut: boolean; onTimeout: Set<() => void> },
): Promise<{ ok: true; res: IncomingMessage } | { ok: false; reason: ThumbnailFailure }> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: { ok: true; res: IncomingMessage } | { ok: false; reason: ThumbnailFailure }) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    let blocked = false
    const req = deps.get(
      url,
      {
        method: "GET",
        // Nothing of the user's travels: no cookies, no auth, no referer.
        headers: { accept: THUMBNAIL_MIME_ALLOWLIST.join(", "), "user-agent": "Arciin-Thumbnail/1.0" },
        lookup: ((hostname: string, options: { family?: number }, callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void) => {
          deps.resolve(hostname, { all: true, family: options?.family }, (err, addresses) => {
            if (err) return callback(err, "", 0)
            if (!addresses.length) return callback(new Error("no address"), "", 0)
            // Every answer must be public; a mixed reply lets the attacker pick.
            if (addresses.some((a) => !isPublicAddress(a.address))) {
              blocked = true
              return callback(new Error("refusing a private address"), "", 0)
            }
            return callback(null, addresses)
          })
        }) as RequestOptions["lookup"],
        agent: false,
      },
      (res) => done({ ok: true, res }),
    )
    const abort = () => {
      req.destroy(new Error("timeout"))
      done({ ok: false, reason: "timeout" })
    }
    signal.onTimeout.add(abort)
    req.on("error", () => done({ ok: false, reason: signal.timedOut ? "timeout" : blocked ? "blocked" : "network" }))
  })
}

function readCapped(res: IncomingMessage, maxBytes: number, signal: { onTimeout: Set<() => void> }): Promise<Buffer | "too_large" | "timeout" | "network"> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    let finished = false
    const finish = (value: Buffer | "too_large" | "timeout" | "network") => {
      if (finished) return
      finished = true
      resolve(value)
    }
    signal.onTimeout.add(() => {
      res.destroy()
      finish("timeout")
    })
    res.on("data", (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        res.destroy()
        finish("too_large")
        return
      }
      chunks.push(chunk)
    })
    res.on("end", () => finish(Buffer.concat(chunks)))
    res.on("error", () => finish("network"))
  })
}

export async function fetchRemoteThumbnail(rawUrl: string, deps: ThumbnailFetchDeps = {}): Promise<ThumbnailResult> {
  const transport = { get: deps.get ?? (httpsGet as unknown as NonNullable<ThumbnailFetchDeps["get"]>), resolve: deps.resolve ?? defaultResolve }
  const maxBytes = deps.maxBytes ?? THUMBNAIL_MAX_BYTES
  const signal = { timedOut: false, onTimeout: new Set<() => void>() }
  const timer = setTimeout(() => {
    signal.timedOut = true
    for (const fn of signal.onTimeout) fn()
  }, deps.timeoutMs ?? THUMBNAIL_TIMEOUT_MS)

  try {
    let current = acceptableThumbnailUrl(rawUrl)
    if (!current) return { ok: false, reason: isBlockedLiteral(rawUrl) ? "blocked" : "invalid_url" }

    for (let hop = 0; ; hop++) {
      const outcome = await requestOnce(current, transport, signal)
      if (!outcome.ok) return outcome
      const { res } = outcome
      const status = res.statusCode ?? 0

      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        if (hop >= THUMBNAIL_MAX_REDIRECTS) return { ok: false, reason: "too_many_redirects" }
        let next: URL | null = null
        try {
          next = acceptableThumbnailUrl(new URL(res.headers.location, current).toString())
        } catch {
          next = null
        }
        // A redirect to anything a first request would be refused for is refused.
        if (!next) return { ok: false, reason: "blocked" }
        current = next
        continue
      }
      if (status !== 200) {
        res.resume()
        return { ok: false, reason: "http_error" }
      }
      const declared = declaredMime(res.headers["content-type"])
      if (!(THUMBNAIL_MIME_ALLOWLIST as readonly string[]).includes(declared)) {
        res.resume()
        return { ok: false, reason: "not_image" }
      }
      const length = Number(res.headers["content-length"])
      if (Number.isFinite(length) && length > maxBytes) {
        res.resume()
        return { ok: false, reason: "too_large" }
      }
      const body = await readCapped(res, maxBytes, signal)
      if (body === "too_large" || body === "timeout" || body === "network") return { ok: false, reason: body }
      const actual = sniffImageType(body.subarray(0, 16))
      if (!actual) return { ok: false, reason: "not_image" }
      return { ok: true, body, contentType: actual }
    }
  } finally {
    clearTimeout(timer)
  }
}

function isBlockedLiteral(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.replace(/^\[|\]$/g, "")
    return Boolean(isIP(host)) && !isPublicAddress(host)
  } catch {
    return false
  }
}
