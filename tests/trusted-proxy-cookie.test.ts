import { describe, expect, it } from "vitest"

import {
  isTrustedProxyPeer,
  requestProtocol,
} from "../apps/api/src/services/security/trusted-proxy"

/**
 * Any client could send `X-Forwarded-Proto: https` and change how the server
 * classified the connection.
 *
 * Measured on this host before the fix: a plain LAN request got a cookie with
 * no Secure attribute, and the identical request carrying a hand-written
 * forwarded header got one with Secure. A browser drops a Secure cookie over
 * plain HTTP, so it is a way to stop someone signing in rather than to steal
 * from them — but the server should not take a stranger's word for how the
 * request reached it either way.
 */

const req = (peer: string | undefined, headers: Record<string, string> = {}, encrypted = false) =>
  ({ socket: { remoteAddress: peer, encrypted }, headers }) as never

describe("only our own hop is believed", () => {
  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])("%s is ours", (peer) => {
    expect(isTrustedProxyPeer(req(peer))).toBe(true)
  })

  it.each(["192.168.4.30", "10.1.2.3", "172.16.0.9", "203.0.113.7"])(
    "%s is not",
    (peer) => {
      /**
       * Deliberately narrower than the trustProxy CIDR list, which includes
       * private ranges because the hop in front of the API sits on one. The
       * API binds 0.0.0.0:4000, so any LAN machine can reach it directly, and
       * trusting 192.168.0.0/16 here would leave the forgery open to exactly
       * the clients most able to try it.
       */
      expect(isTrustedProxyPeer(req(peer))).toBe(false)
    },
  )

  it("treats a missing peer as not ours", () => {
    expect(isTrustedProxyPeer(req(undefined))).toBe(false)
    expect(isTrustedProxyPeer(undefined)).toBe(false)
  })
})

describe("a forged forwarded header changes nothing", () => {
  it.each(["192.168.4.30", "203.0.113.7"])(
    "%s claiming https is still http",
    (peer) => {
      expect(requestProtocol(req(peer, { "x-forwarded-proto": "https" }))).toBe("http")
    },
  )

  it("ignores a forged header even with odd spacing or case", () => {
    for (const value of [" HTTPS ", "https, http", "HtTpS"]) {
      expect(requestProtocol(req("192.168.4.30", { "x-forwarded-proto": value }))).toBe("http")
    }
  })

  it("cannot be used to force http on a genuinely encrypted socket", () => {
    expect(requestProtocol(req("203.0.113.7", { "x-forwarded-proto": "http" }, true))).toBe(
      "https",
    )
  })
})

describe("the real proxy is still believed", () => {
  it("honours https forwarded from loopback", () => {
    // cloudflared -> Next (loopback) -> API. Without this the public tunnel
    // would stop issuing Secure cookies.
    expect(requestProtocol(req("127.0.0.1", { "x-forwarded-proto": "https" }))).toBe("https")
  })

  it("takes the first hop when the header is a list", () => {
    expect(requestProtocol(req("127.0.0.1", { "x-forwarded-proto": "https, http" }))).toBe(
      "https",
    )
  })

  it("honours http forwarded from loopback, so LAN stays LAN", () => {
    expect(requestProtocol(req("127.0.0.1", { "x-forwarded-proto": "http" }))).toBe("http")
  })

  it("falls back to the socket when loopback says nothing", () => {
    expect(requestProtocol(req("127.0.0.1"))).toBe("http")
    expect(requestProtocol(req("127.0.0.1", {}, true))).toBe("https")
  })
})
