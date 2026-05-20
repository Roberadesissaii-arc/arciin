import { isSelfHostedLanHostname, isSelfHostedLanOrigin } from "@arciin/shared"

import { apiConfig } from "@/config"

const developmentOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost",
])

const sseDevOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost",
])

function isSelfHostedInstance(): boolean {
  try {
    return isSelfHostedLanHostname(new URL(apiConfig.ARCIIN_PUBLIC_URL).hostname)
  } catch {
    return true
  }
}

function isCloudflareQuickTunnelOrigin(origin: string) {
  try {
    const { hostname, protocol } = new URL(origin)
    return protocol === "https:" && hostname.endsWith(".trycloudflare.com")
  } catch {
    return false
  }
}

/** Hosted Arciin mobile PWA (e.g. Vercel) — cannot use wildcard in ACAO; match by hostname. */
function isArciinMobileAppHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h.endsWith(".vercel.app") || h === "vercel.app"
}

function mobileAppOriginsFromEnv(): Set<string> {
  const raw = process.env.ARCIIN_MOBILE_APP_ORIGINS?.trim()
  if (!raw) return new Set()
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

const mobileAppOrigins = mobileAppOriginsFromEnv()

export function isCorsOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true

  if (
    !apiConfig.isProduction ||
    isSelfHostedInstance() ||
    origin === apiConfig.ARCIIN_PUBLIC_URL ||
    developmentOrigins.has(origin) ||
    isCloudflareQuickTunnelOrigin(origin) ||
    isSelfHostedLanOrigin(origin) ||
    mobileAppOrigins.has(origin)
  ) {
    return true
  }

  try {
    const { hostname } = new URL(origin)
    if (isArciinMobileAppHost(hostname)) return true
  } catch {
    return false
  }

  return false
}

/** CORS headers for `reply.raw` streams (SSE chat) — must mirror @fastify/cors allowlist. */
export function corsHeadersForRequestOrigin(origin: string | undefined): Record<string, string> {
  if (!origin || !isCorsOriginAllowed(origin)) return {}
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  }
}

export { developmentOrigins, sseDevOrigins, isSelfHostedInstance }
