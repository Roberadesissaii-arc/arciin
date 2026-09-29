import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"

import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The worker's fetch and pre-flight checks under hostile answers: a public
 * page that redirects inward, and a name that resolves to a private address.
 * Inspection and import both go through these.
 */

const requested: string[] = []
let responder: (url: URL) => { statusCode: number; headers: Record<string, string> }

function fakeRequest(url: URL, _opts: unknown, callback: (res: unknown) => void) {
  requested.push(url.toString())
  const req = new EventEmitter() as EventEmitter & { end: () => void; destroy: () => void }
  req.end = () => {
    const { statusCode, headers } = responder(url)
    const stream = new PassThrough()
    Object.assign(stream, { statusCode, headers })
    stream.end("<html></html>")
    callback(stream)
  }
  req.destroy = () => {}
  return req
}

vi.mock("node:https", () => ({ default: { request: fakeRequest } }))
vi.mock("node:http", () => ({ default: { request: fakeRequest } }))

const dnsAnswers = new Map<string, string[]>()
vi.mock("node:dns", () => ({
  lookup: (host: string, _opts: unknown, cb: (err: Error | null, addresses: Array<{ address: string; family: number }>) => void) => {
    const answers = dnsAnswers.get(host)
    if (!answers) return cb(new Error("ENOTFOUND"), [])
    cb(null, answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })))
  },
}))

const { safeRequest, assertExternalDownloadUrlIsPublic } = await import("../apps/worker/src/services/safe-fetch")

beforeEach(() => {
  requested.length = 0
  dnsAnswers.clear()
})

describe("redirects are re-validated on every hop", () => {
  it.each([
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.1.2.3/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://localhost:4000/api",
    "http://printer.local/",
    "file:///etc/passwd",
  ])("a public page redirecting to %s is refused", async (target) => {
    responder = (url) => (url.hostname === "public.example" ? { statusCode: 302, headers: { location: target } } : { statusCode: 200, headers: {} })
    await expect(safeRequest("https://public.example/start")).rejects.toThrow()
    // The inward hop was never requested.
    expect(requested).toEqual(["https://public.example/start"])
  })

  it("a public-to-public redirect is followed", async () => {
    responder = (url) =>
      url.pathname === "/start" ? { statusCode: 301, headers: { location: "https://cdn.example/final" } } : { statusCode: 200, headers: {} }
    const res = await safeRequest("https://public.example/start")
    expect(res.finalUrl).toBe("https://cdn.example/final")
    res.stream.resume()
  })

  it("redirect chains are capped", async () => {
    responder = (url) => ({ statusCode: 302, headers: { location: `https://public.example/${Number(url.pathname.slice(1) || 0) + 1}` } })
    await expect(safeRequest("https://public.example/0", { maxRedirects: 4 })).rejects.toThrow(/too many/)
    expect(requested).toHaveLength(5)
  })
})

describe("names that resolve inward are refused before any tool connects", () => {
  it.each([["127.0.0.1"], ["10.0.0.5"], ["169.254.169.254"], ["::1"], ["fd00::1"]])("resolves to %s", async (address) => {
    dnsAnswers.set("rebind.example", [address])
    await expect(assertExternalDownloadUrlIsPublic("https://rebind.example/video")).rejects.toThrow(/private/)
  })

  it("one private answer among public ones is enough to refuse", async () => {
    dnsAnswers.set("mixed.example", ["93.184.215.14", "192.168.0.10"])
    await expect(assertExternalDownloadUrlIsPublic("https://mixed.example/")).rejects.toThrow(/private/)
  })

  it("a public name passes", async () => {
    dnsAnswers.set("ok.example", ["93.184.215.14"])
    await expect(assertExternalDownloadUrlIsPublic("https://ok.example/")).resolves.toBeUndefined()
  })
})
