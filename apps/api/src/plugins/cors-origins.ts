import { isSelfHostedLanHostname } from "@arciin/shared"

import { apiConfig } from "@/config"
import {
  evaluateCorsOrigin,
  normalizeOrigin,
  type CorsDecisionContext,
} from "@/plugins/cors-policy"
import { getCloudflareTunnelState } from "@/services/remote-access/cloudflare-tunnel"

export { evaluateCorsOrigin, normalizeOrigin, type CorsDecisionContext }

/**
 * Which browser origins may make credentialed requests to this API.
 *
 * Deny by default. Every `true` below names a specific origin the operator
 * configured or a network the instance is itself served on — there is no branch
 * that accepts an origin merely because it parsed.
 *
 * The version this replaced had three escape hatches that, together, accepted
 * anything: `!isProduction`, a blanket `isSelfHostedInstance()` (true for every
 * LAN deployment, i.e. the default), and a bare `catch { return true }`. With
 * `credentials: true` reflecting the caller's own Origin back, a page on any
 * domain was inside the browser's same-origin guarantee. `SameSite=Lax` on the
 * session cookie was the only thing standing between that and cross-site reads.
 *
 * Wildcards are gone for the same reason. `*.vercel.app` meant anyone who can
 * deploy to Vercel — anyone — was trusted, and `*.trycloudflare.com` meant
 * anyone who can open a quick tunnel was too. The mobile PWA now names its
 * origin in `ARCIIN_MOBILE_APP_ORIGINS`, and the tunnel is narrowed to the one
 * URL cloudflared is serving right now.
 */

function originSet(values: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>()
  for (const value of values) {
    const normalized = normalizeOrigin(value)
    if (normalized) out.add(normalized)
  }
  return out
}

/** Extra origins the operator listed explicitly (hosted mobile PWA, reverse proxy hostname). */
function configuredOriginsFromEnv(): Set<string> {
  const raw = [process.env.ARCIIN_MOBILE_APP_ORIGINS, process.env.ARCIIN_EXTRA_CORS_ORIGINS]
    .filter(Boolean)
    .join(",")

  return originSet(raw.split(",").map((s) => s.trim()))
}

const configuredOrigins = configuredOriginsFromEnv()

/** The instance's own addresses. */
function instanceOrigins(): Set<string> {
  return originSet([apiConfig.ARCIIN_PUBLIC_URL, apiConfig.ARCIIN_API_URL])
}

/**
 * True when this instance is itself served on a private network.
 *
 * Deliberately fails closed: an unparseable public URL is a misconfiguration,
 * and the safe reading of a misconfiguration is "not a LAN instance", which
 * grants nothing.
 */
export function isSelfHostedInstance(): boolean {
  try {
    return isSelfHostedLanHostname(new URL(apiConfig.ARCIIN_PUBLIC_URL).hostname)
  } catch {
    return false
  }
}

/**
 * The Cloudflare quick tunnel currently serving this instance — that exact
 * hostname, and only while cloudflared is actually running.
 *
 * A stopped tunnel keeps its URL in state so the UI can explain the 530, but a
 * dead tunnel's hostname is reassignable and must not stay trusted.
 */
export function isActiveTunnelOrigin(origin: string): boolean {
  const candidate = normalizeOrigin(origin)
  if (!candidate) return false

  const state = getCloudflareTunnelState()
  if (!state.running || !state.url) return false
  return normalizeOrigin(state.url) === candidate
}

export function isCorsOriginAllowed(origin: string | undefined): boolean {
  const state = getCloudflareTunnelState()
  return evaluateCorsOrigin(origin, {
    instanceOrigins: instanceOrigins(),
    configuredOrigins,
    activeTunnelOrigin:
      state.running && state.url ? normalizeOrigin(state.url) : null,
    selfHostedInstance: isSelfHostedInstance(),
    isProduction: apiConfig.isProduction,
  })
}

/** CORS headers for `reply.raw` streams (SSE chat) — must mirror the allowlist above. */
export function corsHeadersForRequestOrigin(origin: string | undefined): Record<string, string> {
  const normalized = normalizeOrigin(origin)
  if (!normalized || !isCorsOriginAllowed(origin)) return {}
  return {
    "Access-Control-Allow-Origin": normalized,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  }
}
