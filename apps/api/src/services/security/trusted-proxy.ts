import type { FastifyRequest } from "fastify"

/**
 * Local, so this module can be asserted without a Fastify app or the web
 * alias. Narrower than the general client-IP normaliser on purpose: the only
 * question here is whether the peer is loopback.
 */
function peerAddress(raw: string | null | undefined): string {
  const value = (raw ?? "").trim().toLowerCase()
  // Node reports IPv4 peers over a dual-stack socket as ::ffff:127.0.0.1.
  return value.startsWith("::ffff:") ? value.slice(7) : value
}

/**
 * Whether the machine that opened this connection is one of our own proxies.
 *
 * Forwarded headers describe a hop the server cannot see, so they are only
 * meaningful when the hop that set them is one we put there. Fastify already
 * makes that distinction for X-Forwarded-For through its trustProxy CIDR list;
 * cookie security was reading X-Forwarded-Proto directly and so believed
 * anybody.
 *
 * Measured on this host before the fix: a plain LAN request got a cookie with
 * no Secure attribute, and the identical request with a hand-written
 * `X-Forwarded-Proto: https` got one with Secure. A browser drops a Secure
 * cookie over plain HTTP, so that is a way to stop someone signing in rather
 * than a way to steal from them — but the server should not be taking a
 * stranger's word for how the request reached it either way.
 *
 * Loopback, specifically — not the wider trustProxy CIDR list. That list
 * exists for X-Forwarded-For and deliberately includes private ranges,
 * because the hop in front of the API is on one. But the API binds
 * 0.0.0.0:4000, so any machine on the LAN can reach it directly; trusting
 * 192.168.0.0/16 here would have left the same forgery open to exactly the
 * clients most able to try it. Everything legitimate arrives through Next on
 * loopback, which is the rule clientIpFromRequest already uses for the client
 * IP header, for the same reason.
 */
export function isTrustedProxyPeer(request?: FastifyRequest): boolean {
  const peer = peerAddress(request?.socket?.remoteAddress)
  return peer === "127.0.0.1" || peer === "::1"
}

/**
 * The scheme the client actually used, as far as the server can honestly tell.
 *
 * Trusts X-Forwarded-Proto only from a trusted peer. Falls back to whether
 * this connection itself is encrypted.
 */
export function requestProtocol(request?: FastifyRequest): "http" | "https" {
  if (isTrustedProxyPeer(request)) {
    const forwarded = request?.headers["x-forwarded-proto"]
    if (typeof forwarded === "string") {
      const first = forwarded.split(",")[0]?.trim().toLowerCase()
      if (first === "https") return "https"
      if (first === "http") return "http"
    }
  }

  // No trusted hop said otherwise: believe the socket.
  return (request?.socket as { encrypted?: boolean } | undefined)?.encrypted ? "https" : "http"
}
