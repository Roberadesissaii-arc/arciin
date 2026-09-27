import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildUpstreamApiHeaders,
  proxyApiRequest,
  proxyFailure,
} from "../apps/web/lib/server/api-proxy"

/**
 * The web surface's /api proxy must never turn an API answer into a bodyless
 * error.
 *
 * Found while chasing "403 with an empty body" from an external integration:
 * curl (>1 MB bodies), .NET HttpClient, and many Java clients send
 * `Expect: 100-continue` on uploads. The proxy forwarded it, undici's fetch
 * refuses that header outright, and Next answered 500 with no body — so the
 * API's own JSON (a 403 for a missing scope, say) never reached the caller.
 */

describe("buildUpstreamApiHeaders", () => {
  it("drops Expect and other hop-by-hop headers, keeps auth", () => {
    const incoming = new Headers({
      expect: "100-continue",
      connection: "keep-alive",
      "transfer-encoding": "chunked",
      authorization: "Bearer arc_x",
      "content-type": "multipart/form-data; boundary=abc",
    })
    const out = buildUpstreamApiHeaders(incoming, "203.0.113.9")
    expect(out.get("expect")).toBeNull()
    expect(out.get("connection")).toBeNull()
    expect(out.get("transfer-encoding")).toBeNull()
    expect(out.get("authorization")).toBe("Bearer arc_x")
    expect(out.get("content-type")).toContain("multipart/form-data")
  })
})

describe("proxy failure", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("is a JSON envelope, never an empty body", async () => {
    const res = proxyFailure()
    expect(res.status).toBe(502)
    expect(res.headers.get("content-type")).toContain("application/json")
    expect(await res.json()).toEqual({
      error: expect.objectContaining({ code: "UPSTREAM_UNAVAILABLE" }),
    })
  })

  it("a thrown upstream fetch becomes that envelope, with no internals in it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: { code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:4000" },
        })
      }),
    )
    vi.spyOn(console, "error").mockImplementation(() => {})
    const res = await proxyApiRequest(
      new Request("http://127.0.0.1:3002/api/assets", { method: "GET" }),
      "/api/assets",
    )
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).toContain("UPSTREAM_UNAVAILABLE")
    expect(text).not.toContain("127.0.0.1")
    expect(text).not.toContain("ECONNREFUSED")
  })

  it("an upstream 403 passes through with its body intact", async () => {
    const body = JSON.stringify({ error: { code: "FORBIDDEN", message: "This API key is missing a required scope." } })
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      // The proxy must not hand undici an Expect header.
      expect(new Headers(init.headers).get("expect")).toBeNull()
      return new Response(body, { status: 403, headers: { "content-type": "application/json" } })
    })
    vi.stubGlobal("fetch", fetchMock)
    const res = await proxyApiRequest(
      new Request("http://127.0.0.1:3002/api/uploads", {
        method: "POST",
        headers: { expect: "100-continue", authorization: "Bearer arc_x" },
        body: "x".repeat(2048),
      }),
      "/api/uploads",
    )
    expect(res.status).toBe(403)
    expect(await res.text()).toBe(body)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
