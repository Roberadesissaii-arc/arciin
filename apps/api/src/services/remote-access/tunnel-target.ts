import { resolveLocalAccessUrls, resolveMobileLocalAccessUrls } from "@/services/remote-access/local-access-urls"

/** Local origin cloudflared should forward to (Next.js web UI on loopback, never the API port). */
export function resolveCloudflareTunnelTarget(): string {
  const explicit = process.env.ARCIIN_TUNNEL_TARGET?.trim()
  if (explicit) return explicit.replace(/\/+$/, "")

  const { loopbackUrl } = resolveLocalAccessUrls()
  return loopbackUrl
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

  const { loopbackUrl } = resolveMobileLocalAccessUrls()
  return loopbackUrl
}
