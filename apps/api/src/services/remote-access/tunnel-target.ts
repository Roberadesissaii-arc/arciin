import { formatAdvertisedHttpOrigin } from "@arciin/config"

import { resolveMobileWebPort, resolveWebPort } from "@/services/remote-access/local-access-urls"

/**
 * Local origin cloudflared should forward to.
 *
 * This is the *internal* web listen address (or an explicit
 * `ARCIIN_TUNNEL_TARGET` such as `http://caddy:80` in Docker), never the
 * customer-facing advertised LAN URL.
 */
export function resolveCloudflareTunnelTarget(): string {
  const explicit = process.env.ARCIIN_TUNNEL_TARGET?.trim()
  if (explicit) return explicit.replace(/\/+$/, "")

  return formatAdvertisedHttpOrigin("127.0.0.1", resolveWebPort())
}

/**
 * Tunnel target for the standalone mobile PWA.
 *
 * No longer used by the normal flow: a tunnel here would serve *only* the
 * mobile app, and since one cloudflared process is all Arciin can run, that
 * meant the desktop app lost its domain. Retained for an operator who sets
 * ARCIIN_MOBILE_TUNNEL_TARGET deliberately.
 */
export function resolveMobileCloudflareTunnelTarget(): string {
  const explicit = process.env.ARCIIN_MOBILE_TUNNEL_TARGET?.trim()
  if (explicit) return explicit.replace(/\/+$/, "")

  return formatAdvertisedHttpOrigin("127.0.0.1", resolveMobileWebPort())
}
