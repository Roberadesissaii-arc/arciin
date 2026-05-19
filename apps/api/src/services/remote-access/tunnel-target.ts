import { resolveLocalAccessUrls } from "@/services/remote-access/local-access-urls"

/** Local origin cloudflared should forward to (Next.js web UI on loopback, never the API port). */
export function resolveCloudflareTunnelTarget(): string {
  const explicit = process.env.ARCIIN_TUNNEL_TARGET?.trim()
  if (explicit) return explicit.replace(/\/+$/, "")

  const { loopbackUrl } = resolveLocalAccessUrls()
  return loopbackUrl
}
