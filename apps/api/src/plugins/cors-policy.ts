import { isSelfHostedLanOrigin } from "@arciin/shared"

/**
 * The CORS allowlist rule, with nothing environmental in it.
 *
 * Deliberately separate from cors-origins.ts, which wires this to `apiConfig`
 * and the tunnel process. The rule is the part worth asserting, and a test that
 * has to boot the API's config module to ask "is evil.example.com allowed?"
 * ends up testing the environment instead.
 *
 * The rule is deny-by-default. Its predecessor was not: `!isProduction`, a
 * blanket `isSelfHostedInstance()` (true for every LAN deployment, which is the
 * default) and a bare `catch { return true }` between them accepted any origin
 * at all, and the API reflected it back with `credentials: true`.
 */

/** Parse to a canonical `scheme://host[:port]`, or null when it is not a usable web origin. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  // Opaque origins (sandboxed iframes, `file://` pages) serialize as "null".
  if (!trimmed || trimmed.toLowerCase() === "null") return null

  try {
    const url = new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.origin.toLowerCase()
  } catch {
    return null
  }
}

/** Localhost on any port, for `pnpm dev` only. */
export function isLocalDevOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
  } catch {
    return false
  }
}

export type CorsDecisionContext = {
  /** ARCIIN_PUBLIC_URL / ARCIIN_API_URL, normalized. */
  instanceOrigins: Set<string>
  /** ARCIIN_MOBILE_APP_ORIGINS / ARCIIN_EXTRA_CORS_ORIGINS, normalized. */
  configuredOrigins: Set<string>
  /** The live cloudflared URL, normalized — null when no tunnel is running. */
  activeTunnelOrigin: string | null
  /** True when this instance is itself served on a private network. */
  selfHostedInstance: boolean
  isProduction: boolean
}

export function evaluateCorsOrigin(
  origin: string | undefined | null,
  ctx: CorsDecisionContext,
): boolean {
  // No Origin header at all: same-origin navigation, curl, or a native client.
  // Not a cross-origin request, so there is no CORS decision to make.
  if (origin === undefined || origin === null) return true

  const normalized = normalizeOrigin(origin)
  if (!normalized) return false

  if (ctx.instanceOrigins.has(normalized)) return true
  if (ctx.configuredOrigins.has(normalized)) return true
  if (ctx.activeTunnelOrigin && ctx.activeTunnelOrigin === normalized) return true

  // A LAN-hosted instance is commonly reached by more than one private address
  // (hostname, 192.168.x.x, Tailscale). Allow other private-network origins in
  // that case only — a public attacker's origin is never an RFC1918 address.
  if (ctx.selfHostedInstance && isSelfHostedLanOrigin(normalized)) return true

  if (!ctx.isProduction && isLocalDevOrigin(normalized)) return true

  return false
}
