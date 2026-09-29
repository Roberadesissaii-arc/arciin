import { isSelfHostedLanHostname, isSelfHostedLanOrigin } from "@arciin/shared"

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

/** Why a stored public URL was not turned into a trusted origin. */
export type CustomOriginRejection = "empty" | "malformed" | "scheme" | "credentials" | "quick-tunnel" | "insecure"

const QUICK_TUNNEL_HOST = /(^|\.)trycloudflare\.com$/i

function isPrivateOrLocalHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") return true
  return isSelfHostedLanHostname(hostname)
}

/**
 * The exact origin the owner's configured custom public URL stands for.
 *
 * Settings → Domain stores it in InstanceConfig.publicUrl, and until now it
 * advertised the address without trusting it: https://app.arciin.com served
 * the sign-in page and then had every login answered 403 "Origin not allowed".
 *
 * Only the origin is taken — scheme, lower-cased host, non-default port. A
 * trycloudflare.com address is never a custom domain: it is trusted only while
 * that exact tunnel is running (activeTunnelOrigin), because a dead tunnel's
 * hostname can be handed to someone else. Credentials in the URL, non-web
 * schemes, and plain http for a public hostname in production are refused.
 */
export function customOriginFromPublicUrl(
  raw: string | null | undefined,
  opts: { isProduction: boolean },
): { origin: string; publicHost: boolean } | { origin: null; reason: CustomOriginRejection } {
  const value = raw?.trim()
  if (!value) return { origin: null, reason: "empty" }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { origin: null, reason: "malformed" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { origin: null, reason: "scheme" }
  if (url.username || url.password) return { origin: null, reason: "credentials" }
  if (QUICK_TUNNEL_HOST.test(url.hostname)) return { origin: null, reason: "quick-tunnel" }
  const publicHost = !isPrivateOrLocalHostname(url.hostname)
  if (publicHost && opts.isProduction && url.protocol !== "https:") return { origin: null, reason: "insecure" }
  const origin = normalizeOrigin(url.origin)
  if (!origin) return { origin: null, reason: "malformed" }
  return { origin, publicHost }
}

export type CorsDecisionContext = {
  /** ARCIIN_PUBLIC_URL / ARCIIN_API_URL, normalized. */
  instanceOrigins: Set<string>
  /** ARCIIN_MOBILE_APP_ORIGINS / ARCIIN_EXTRA_CORS_ORIGINS, normalized. */
  configuredOrigins: Set<string>
  /** The live cloudflared URL, normalized — null when no tunnel is running. */
  activeTunnelOrigin: string | null
  /** The owner's custom public domain (Settings → Domain), exact origin — null when none is trusted. */
  customPublicOrigin?: string | null
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
  if (ctx.customPublicOrigin && ctx.customPublicOrigin === normalized) return true

  // A LAN-hosted instance is commonly reached by more than one private address
  // (hostname, 192.168.x.x, Tailscale). Allow other private-network origins in
  // that case only — a public attacker's origin is never an RFC1918 address.
  if (ctx.selfHostedInstance && isSelfHostedLanOrigin(normalized)) return true

  if (!ctx.isProduction && isLocalDevOrigin(normalized)) return true

  return false
}
