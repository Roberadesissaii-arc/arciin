/**
 * Resolve credentialed API URLs in the browser so session cookies match the page origin.
 * (Upload/chat must not POST to localhost:4000 while the user opened 192.168.x.x:3002.)
 */

function configuredApiOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_ARCIIN_API_ORIGIN?.trim()
  if (!raw) return null
  return raw.replace(/\/$/, "")
}

function normalizeApiPath(path: string): string {
  const trimmed = path.replace(/^\//, "")
  return trimmed.startsWith("api/") ? `/${trimmed}` : `/api/${trimmed}`
}

/** Origin for browser credentialed calls, or null during SSR. */
export function getBrowserApiOrigin(): string | null {
  if (typeof window === "undefined") return null

  const configured = configuredApiOrigin()
  if (configured) {
    try {
      const apiUrl = new URL(configured.includes("://") ? configured : `http://${configured}`)
      if (apiUrl.host === window.location.host) {
        return apiUrl.origin
      }
    } catch {
      // use page origin
    }
  }

  return window.location.origin
}

/** Full URL for a credentialed browser API request (uploads, SSE chat, etc.). */
export function getBrowserApiUrl(path: string): string {
  const apiPath = normalizeApiPath(path)
  const browserOrigin = getBrowserApiOrigin()
  if (browserOrigin) {
    return `${browserOrigin}${apiPath}`
  }

  const configured = configuredApiOrigin()
  if (configured) {
    try {
      const base = new URL(configured.includes("://") ? configured : `http://${configured}`)
      return `${base.origin}${apiPath}`
    } catch {
      // fall through
    }
  }

  if (process.env.NODE_ENV === "development") {
    const port = process.env.API_PORT || process.env.NEXT_PUBLIC_API_PORT || "4000"
    return `http://127.0.0.1:${port}${apiPath}`
  }

  const publicBase = (process.env.NEXT_PUBLIC_API_BASE_URL || "/api").replace(/\/$/, "")
  if (publicBase.startsWith("http")) {
    return `${publicBase}${apiPath.replace(/^\/api/, "")}`
  }

  return apiPath
}
