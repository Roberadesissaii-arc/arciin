import { EventEmitter } from "node:events"
import type { LookupAddress } from "node:dns"
import type { IncomingMessage, RequestOptions } from "node:http"
import { PassThrough } from "node:stream"

import { describe, expect, it } from "vitest"

import {
  THUMBNAIL_MAX_REDIRECTS,
  acceptableThumbnailUrl,
  fetchRemoteThumbnail,
  sniffImageType,
  type ThumbnailFetchDeps,
} from "../apps/api/src/services/imports/thumbnail-proxy"

/**
 * The thumbnail proxy's fetch, against a fake network. The fake transport
 * still calls the real `lookup` the fetcher hands it — that is where private
 * addresses are refused — so DNS answers are part of each scenario.
 */

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])
const HTML = Buffer.from("<!doctype html><title>not an image</title>")

type Reply = { status: number; headers?: Record<string, string>; body?: Buffer; neverEnds?: boolean; chunks?: number }

function network(dns: Record<string, string[]>, replies: Record<string, Reply>) {
  const requested: string[] = []
  const sentHeaders: Array<Record<string, unknown>> = []
  const resolve: NonNullable<ThumbnailFetchDeps["resolve"]> = (hostname, _options, callback) => {
    const addresses = dns[hostname]
    if (!addresses) return callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), [])
    callback(null, addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }) as LookupAddress))
  }
  const get: NonNullable<ThumbnailFetchDeps["get"]> = (url: URL, options: RequestOptions, onResponse: (res: IncomingMessage) => void) => {
    const req = new EventEmitter() as EventEmitter & { destroy: (err?: Error) => void }
    let destroyed = false
    req.destroy = (err?: Error) => {
      destroyed = true
      if (err) queueMicrotask(() => req.emit("error", err))
    }
    requested.push(url.href)
    sentHeaders.push({ ...(options.headers as Record<string, unknown>) })
    const host = url.hostname.replace(/^\[|\]$/g, "")
    const connect = () => {
      if (destroyed) return
      const reply = replies[url.href]
      if (!reply) return req.emit("error", new Error("ECONNREFUSED"))
      const res = new PassThrough() as unknown as IncomingMessage & PassThrough
      res.statusCode = reply.status
      res.headers = Object.fromEntries(Object.entries(reply.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
      onResponse(res)
      if (reply.neverEnds) return
      const body = reply.body ?? Buffer.alloc(0)
      const n = reply.chunks ?? 1
      const size = Math.ceil(body.length / n) || 1
      for (let i = 0; i < body.length; i += size) res.write(body.subarray(i, i + size))
      res.end()
    }
    // Real https skips lookup for an IP literal; so does the fake.
    if (/^[\d.]+$/.test(host) || host.includes(":")) {
      queueMicrotask(connect)
    } else {
      ;(options.lookup as unknown as (h: string, o: object, cb: (err: Error | null) => void) => void)(host, {}, (err) => {
        if (err) return queueMicrotask(() => req.emit("error", err))
        queueMicrotask(connect)
      })
    }
    return req
  }
  return { deps: { get, resolve } satisfies ThumbnailFetchDeps, requested, sentHeaders }
}

const PUBLIC = { "img.example.com": ["93.184.215.14"], "cdn.example.com": ["93.184.215.15"] }

describe("acceptableThumbnailUrl", () => {
  it.each([
    ["https://img.example.com/a.jpg", true],
    ["http://img.example.com/a.jpg", false],
    ["https://user:pw@img.example.com/a.jpg", false],
    ["https://img.example.com:8443/a.jpg", false],
    ["https://localhost/a.jpg", false],
    ["https://metadata.internal/a.jpg", false],
    ["https://intranet/a.jpg", false],
    ["https://127.0.0.1/a.jpg", false],
    ["https://169.254.169.254/latest/meta-data", false],
    ["https://[::1]/a.jpg", false],
    ["https://[::ffff:7f00:1]/a.jpg", false],
    ["https://93.184.215.14/a.jpg", true],
    ["javascript:alert(1)", false],
    ["not a url", false],
  ])("%s → %s", (url, ok) => {
    expect(Boolean(acceptableThumbnailUrl(url))).toBe(ok)
  })
})

describe("sniffImageType", () => {
  it("knows the allowed formats by their bytes, and nothing else", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg")
    expect(sniffImageType(Buffer.from("89504e470d0a1a0a", "hex"))).toBe("image/png")
    expect(sniffImageType(Buffer.from("GIF89a"))).toBe("image/gif")
    expect(sniffImageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))).toBe("image/webp")
    expect(sniffImageType(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypavif")]))).toBe("image/avif")
    expect(sniffImageType(HTML)).toBeNull()
    expect(sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull()
  })
})

describe("fetchRemoteThumbnail", () => {
  it("a valid thumbnail", async () => {
    const net = network(PUBLIC, { "https://img.example.com/a.jpg": { status: 200, headers: { "content-type": "image/jpeg" }, body: JPEG } })
    const res = await fetchRemoteThumbnail("https://img.example.com/a.jpg", net.deps)
    expect(res).toMatchObject({ ok: true, contentType: "image/jpeg" })
  })

  it("sends no cookies, no authorization, no referer", async () => {
    const net = network(PUBLIC, { "https://img.example.com/a.jpg": { status: 200, headers: { "content-type": "image/jpeg" }, body: JPEG } })
    await fetchRemoteThumbnail("https://img.example.com/a.jpg", net.deps)
    const headers = Object.keys(net.sentHeaders[0]!).map((k) => k.toLowerCase())
    expect(headers).not.toContain("cookie")
    expect(headers).not.toContain("authorization")
    expect(headers).not.toContain("referer")
    expect(headers.filter((h) => h.startsWith("x-forwarded"))).toEqual([])
  })

  it("404", async () => {
    const net = network(PUBLIC, { "https://img.example.com/a.jpg": { status: 404 } })
    expect(await fetchRemoteThumbnail("https://img.example.com/a.jpg", net.deps)).toEqual({ ok: false, reason: "http_error" })
  })

  it("timeout: a server that never finishes", async () => {
    const net = network(PUBLIC, { "https://img.example.com/a.jpg": { status: 200, headers: { "content-type": "image/jpeg" }, neverEnds: true } })
    const started = Date.now()
    expect(await fetchRemoteThumbnail("https://img.example.com/a.jpg", { ...net.deps, timeoutMs: 150 })).toEqual({ ok: false, reason: "timeout" })
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it("a non-image response, and an HTML page that claims to be a PNG", async () => {
    const net = network(PUBLIC, {
      "https://img.example.com/page": { status: 200, headers: { "content-type": "text/html" }, body: HTML },
      "https://img.example.com/liar.png": { status: 200, headers: { "content-type": "image/png" }, body: HTML },
      "https://img.example.com/x.svg": { status: 200, headers: { "content-type": "image/svg+xml" }, body: Buffer.from("<svg/>") },
    })
    for (const url of ["https://img.example.com/page", "https://img.example.com/liar.png", "https://img.example.com/x.svg"]) {
      expect(await fetchRemoteThumbnail(url, net.deps), url).toEqual({ ok: false, reason: "not_image" })
    }
  })

  it("a host that resolves to a private address is never connected to", async () => {
    const net = network({ "evil.example.com": ["10.0.0.5"], "mixed.example.com": ["93.184.215.14", "127.0.0.1"] }, {
      "https://evil.example.com/a.jpg": { status: 200, headers: { "content-type": "image/jpeg" }, body: JPEG },
      "https://mixed.example.com/a.jpg": { status: 200, headers: { "content-type": "image/jpeg" }, body: JPEG },
    })
    expect(await fetchRemoteThumbnail("https://evil.example.com/a.jpg", net.deps)).toEqual({ ok: false, reason: "blocked" })
    expect(await fetchRemoteThumbnail("https://mixed.example.com/a.jpg", net.deps)).toEqual({ ok: false, reason: "blocked" })
  })

  it("a private IP literal is refused without a request", async () => {
    const net = network(PUBLIC, {})
    expect(await fetchRemoteThumbnail("https://169.254.169.254/latest/meta-data", net.deps)).toEqual({ ok: false, reason: "blocked" })
    expect(net.requested).toEqual([])
  })

  it("redirects are followed and each hop is checked: to a private literal, to a rebinding name, to http", async () => {
    const net = network({ ...PUBLIC, "rebind.example.com": ["192.168.1.1"] }, {
      "https://img.example.com/to-literal": { status: 302, headers: { location: "https://127.0.0.1/secret" } },
      "https://img.example.com/to-name": { status: 301, headers: { location: "https://rebind.example.com/x.jpg" } },
      "https://img.example.com/to-http": { status: 307, headers: { location: "http://cdn.example.com/x.jpg" } },
      "https://rebind.example.com/x.jpg": { status: 200, headers: { "content-type": "image/jpeg" }, body: JPEG },
      "https://img.example.com/ok": { status: 302, headers: { location: "/final.jpg" } },
      "https://img.example.com/final.jpg": { status: 200, headers: { "content-type": "image/jpeg" }, body: JPEG },
    })
    expect(await fetchRemoteThumbnail("https://img.example.com/to-literal", net.deps)).toEqual({ ok: false, reason: "blocked" })
    expect(await fetchRemoteThumbnail("https://img.example.com/to-name", net.deps)).toEqual({ ok: false, reason: "blocked" })
    expect(await fetchRemoteThumbnail("https://img.example.com/to-http", net.deps)).toEqual({ ok: false, reason: "blocked" })
    expect(net.requested).not.toContain("https://127.0.0.1/secret")
    expect(await fetchRemoteThumbnail("https://img.example.com/ok", net.deps)).toMatchObject({ ok: true })
  })

  it("at most THUMBNAIL_MAX_REDIRECTS hops", async () => {
    const replies: Record<string, Reply> = {}
    for (let i = 0; i < 10; i++) replies[`https://img.example.com/r${i}`] = { status: 302, headers: { location: `/r${i + 1}` } }
    const net = network(PUBLIC, replies)
    expect(await fetchRemoteThumbnail("https://img.example.com/r0", net.deps)).toEqual({ ok: false, reason: "too_many_redirects" })
    expect(net.requested).toHaveLength(THUMBNAIL_MAX_REDIRECTS + 1)
  })

  it("oversized: refused by Content-Length, and cut off while streaming when it lies", async () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(4096)])
    const net = network(PUBLIC, {
      "https://img.example.com/declared": { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(big.length) }, body: big },
      "https://img.example.com/streamed": { status: 200, headers: { "content-type": "image/jpeg" }, body: big, chunks: 8 },
    })
    expect(await fetchRemoteThumbnail("https://img.example.com/declared", { ...net.deps, maxBytes: 1024 })).toEqual({ ok: false, reason: "too_large" })
    expect(await fetchRemoteThumbnail("https://img.example.com/streamed", { ...net.deps, maxBytes: 1024 })).toEqual({ ok: false, reason: "too_large" })
  })
})
