/**
 * Customer-facing HTTP origin (what a browser on the LAN should open).
 *
 * Distinct from the Next.js listen port (`ARCIIN_WEB_PORT` / `PORT`).
 * Docker/Caddy publishes `${ARCIIN_HTTP_PORT:-80}:80`; the API process
 * still listens on 4000 and the web container on 3000.
 *
 * Precedence for the advertised port:
 *  1. Explicit port on the trusted public URL (never invent a different one)
 *  2. Docker/Caddy runtime: `ARCIIN_HTTP_PORT`, else 80
 *  3. Native/dev: `ARCIIN_WEB_PORT` or `PORT` (never the API port)
 *  4. Development-only fallback 3000
 */

const FALLBACK_API_PORTS = new Set(["4000", "4001"])

export type AdvertisedHttpPortInput = {
  publicUrl?: string | null
  mobilePublicUrl?: string | null
  httpPort?: string | null
  webPort?: string | null
  processPort?: string | null
  apiPort?: string | number | null
  /** Existing container detection — never infer Docker from an IP address. */
  inContainer: boolean
}

export function isReservedApiPort(
  port: string,
  apiPort?: string | number | null,
): boolean {
  if (!port) return false
  if (apiPort != null && port === String(apiPort)) return true
  return FALLBACK_API_PORTS.has(port)
}

/** Port written in a trusted URL, or null when the URL uses the scheme default. */
export function explicitPortFromTrustedUrl(
  raw: string | null | undefined,
  apiPort?: string | number | null,
): string | null {
  if (!raw?.trim()) return null
  try {
    const parsed = new URL(raw.trim())
    if (parsed.port && !isReservedApiPort(parsed.port, apiPort)) {
      return parsed.port
    }
    return null
  } catch {
    return null
  }
}

export function resolveAdvertisedHttpPort(input: AdvertisedHttpPortInput): string {
  const explicit = explicitPortFromTrustedUrl(input.publicUrl, input.apiPort)
  if (explicit) return explicit

  if (input.inContainer) {
    const published = input.httpPort?.trim()
    if (published && !isReservedApiPort(published, input.apiPort)) {
      return published
    }
    return "80"
  }

  const fromEnv = input.webPort?.trim() || input.processPort?.trim()
  if (fromEnv && !isReservedApiPort(fromEnv, input.apiPort)) {
    return fromEnv
  }

  return "3000"
}

export function resolveAdvertisedMobileHttpPort(input: AdvertisedHttpPortInput): string {
  const explicit = explicitPortFromTrustedUrl(input.mobilePublicUrl, input.apiPort)
  if (explicit) return explicit
  return resolveAdvertisedHttpPort(input)
}

/**
 * Canonical origin: omit :80 for http and :443 for https.
 * IPv6 hosts are bracketed.
 */
export function formatAdvertisedHttpOrigin(
  host: string,
  port: string,
  protocol: "http" | "https" = "http",
): string {
  const bare = host.trim().replace(/^\[/, "").replace(/\]$/, "")
  if (!bare) {
    throw new Error("advertised origin host is empty")
  }
  const authority = bare.includes(":") ? `[${bare}]` : bare
  const url = new URL(`${protocol}://${authority}`)
  const defaultPort = protocol === "https" ? "443" : "80"
  if (port && port !== defaultPort) {
    url.port = port
  }
  return url.origin
}

export function buildAdvertisedLocalAccessUrls(input: {
  lanHosts: string[]
  preferredHost?: string | null
  port: string
  protocol?: "http" | "https"
  loopbackHost?: string
}): {
  webPort: string
  loopbackUrl: string
  lanUrls: string[]
  primaryLanUrl: string | null
  localUrl: string
} {
  const protocol = input.protocol ?? "http"
  const port = input.port
  const loopbackUrl = formatAdvertisedHttpOrigin(input.loopbackHost ?? "127.0.0.1", port, protocol)
  const preferredHost = input.preferredHost?.trim() || null
  const hosts = new Set<string>()
  if (preferredHost) hosts.add(preferredHost)
  for (const host of input.lanHosts) {
    if (host.trim()) hosts.add(host.trim())
  }
  const preferredUrl = preferredHost
    ? formatAdvertisedHttpOrigin(preferredHost, port, protocol)
    : null
  const lanUrls = [...hosts]
    .map((host) => formatAdvertisedHttpOrigin(host, port, protocol))
    .sort((a, b) => {
      if (preferredUrl) {
        if (a === preferredUrl && b !== preferredUrl) return -1
        if (b === preferredUrl && a !== preferredUrl) return 1
      }
      return a.localeCompare(b, "en")
    })
  const primaryLanUrl = lanUrls[0] ?? null
  return {
    webPort: port,
    loopbackUrl,
    lanUrls,
    primaryLanUrl,
    localUrl: primaryLanUrl ?? loopbackUrl,
  }
}
