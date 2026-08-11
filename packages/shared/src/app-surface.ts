/**
 * Which Arciin app a request should be served by.
 *
 * Arciin runs two Next.js apps: the desktop UI on ARCIIN_WEB_PORT and the
 * mobile PWA on ARCIIN_MOBILE_PORT. Only one Cloudflare quick tunnel can exist
 * at a time — `tunnelProcess` is a module-level singleton and
 * `startCloudflareQuickTunnel` stops the running one before starting another —
 * so generating a domain for one app took the other's domain away.
 *
 * The fix is to stop trying to have two domains. One tunnel points at the
 * desktop origin, and this module decides, per request, which app answers.
 *
 * ---------------------------------------------------------------------------
 * The part that is easy to get wrong
 * ---------------------------------------------------------------------------
 *
 * Both apps serve their own `/_next/*` bundles under the same paths, and an
 * asset request carries no clue about which app's page asked for it. Routing
 * assets by user agent therefore breaks the one case that matters most: a
 * *share link* opened on a phone is served by the desktop app (only it has
 * `/s/…`), but its asset requests come from a phone — so they were routed to
 * the mobile app and 404'd, and the page rendered blank.
 *
 * So documents and assets are decided differently:
 *
 *   - A *document* request picks its surface from the URL, an explicit user
 *     override, then the user agent — and records the result in a cookie.
 *   - An *asset* request follows that recorded cookie, because the only correct
 *     answer is "whichever app served the page I belong to".
 *
 * Two separate cookies, because they answer different questions: `arciin_view`
 * is the user's explicit choice and survives navigation; `arciin_surface` is
 * just "what served the last page", and must not override the user agent on the
 * next navigation.
 *
 * Pure: no Next, no node:http. Every rule is unit-testable.
 */

export type AppSurface = "desktop" | "mobile"

/** Records which app served the last document, so its assets can follow. */
export const SURFACE_COOKIE = "arciin_surface"
/** The user's explicit "show me the other version" choice. */
export const VIEW_COOKIE = "arciin_view"
export const SURFACE_QUERY_PARAM = "view"

/**
 * Paths the desktop app always serves, whatever the device.
 *
 * `/s/` and `/request/` are public links. Someone opening a share or an upload
 * request on a phone must get the page, and those routes exist only in the
 * desktop app — routing them by device would 404 exactly the people the links
 * were sent to.
 */
export const DESKTOP_ONLY_PREFIXES = [
  "/api",
  "/socket.io",
  "/s/",
  "/request/",
] as const

/** Build output and other per-app static files. Neither app can serve the other's. */
export const ASSET_PREFIXES = ["/_next/"] as const

const ALWAYS_DESKTOP_EXACT = new Set(["/robots.txt", "/favicon.ico"])

export type SurfaceDecision = {
  surface: AppSurface
  /** True when the caller should proxy to the mobile origin instead of serving locally. */
  proxyToMobile: boolean
  /** Set when the user made an explicit choice worth remembering. */
  setViewCookie: AppSurface | null
  /** Set on document responses so this page's assets resolve to the same app. */
  setSurfaceCookie: AppSurface | null
  reason:
    | "shared-path"
    | "mobile-unavailable"
    | "asset-follows-page"
    | "query-override"
    | "view-cookie"
    | "user-agent"
}

export type SurfaceInput = {
  pathname: string
  userAgent?: string | null
  /** The user's explicit override cookie, if any. */
  viewCookie?: string | null
  /** Which app served the last document for this client. */
  surfaceCookie?: string | null
  /** Value of `?view=` on this request. */
  queryOverride?: string | null
  /**
   * True for top-level navigations (`Sec-Fetch-Dest: document`, or an Accept
   * header asking for HTML). Assets are routed by the cookie instead.
   */
  isDocumentRequest: boolean
  /** False when no mobile origin is configured — everything stays on desktop. */
  mobileAvailable: boolean
}

export function isDesktopOnlyPath(pathname: string): boolean {
  if (ALWAYS_DESKTOP_EXACT.has(pathname)) return true
  return DESKTOP_ONLY_PREFIXES.some(
    (prefix) =>
      pathname === prefix ||
      pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  )
}

export function isAssetPath(pathname: string): boolean {
  return ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function parseSurface(value: string | null | undefined): AppSurface | null {
  if (value === "desktop" || value === "mobile") return value
  return null
}

/**
 * Whether a user agent belongs to a phone-sized client.
 *
 * Deliberately conservative: tablets and desktops get the desktop app, which is
 * the responsive one. Only clients that clearly identify as phones are routed
 * to the mobile PWA, so an unrecognised agent degrades to the richer UI rather
 * than the cut-down one.
 *
 * `iPad` is excluded explicitly. Modern iPadOS reports a desktop Safari agent
 * anyway, and the desktop app is the better experience at that size.
 */
export function isPhoneUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()

  // Android tablets omit "mobile"; Android phones include it.
  if (ua.includes("android")) return ua.includes("mobile")

  if (ua.includes("ipad")) return false
  if (ua.includes("iphone") || ua.includes("ipod")) return true

  return (
    ua.includes("windows phone") ||
    ua.includes("iemobile") ||
    ua.includes("blackberry") ||
    ua.includes("bb10") ||
    ua.includes("opera mini") ||
    ua.includes("opera mobi") ||
    /\bmobile\b/.test(ua)
  )
}

export function decideAppSurface(input: SurfaceInput): SurfaceDecision {
  const desktop = (reason: SurfaceDecision["reason"]): SurfaceDecision => ({
    surface: "desktop",
    proxyToMobile: false,
    setViewCookie: null,
    setSurfaceCookie: input.isDocumentRequest ? "desktop" : null,
    reason,
  })

  // Shared and public paths are decided before anything else so no client state
  // can send a share link or an API call to the wrong app.
  if (isDesktopOnlyPath(input.pathname)) return desktop("shared-path")

  if (!input.mobileAvailable) return desktop("mobile-unavailable")

  // An asset belongs to whichever app rendered the page requesting it. This is
  // the rule that keeps a desktop-served share page working on a phone.
  if (!input.isDocumentRequest && isAssetPath(input.pathname)) {
    const recorded = parseSurface(input.surfaceCookie)
    if (recorded) {
      return {
        surface: recorded,
        proxyToMobile: recorded === "mobile",
        setViewCookie: null,
        setSurfaceCookie: null,
        reason: "asset-follows-page",
      }
    }
    // No cookie yet (first paint, or cookies blocked): fall through to the
    // agent, which is right for every case except the share-on-a-phone one the
    // cookie exists to cover.
  }

  const override = parseSurface(input.queryOverride)
  if (override) {
    return {
      surface: override,
      proxyToMobile: override === "mobile",
      setViewCookie: override,
      setSurfaceCookie: input.isDocumentRequest ? override : null,
      reason: "query-override",
    }
  }

  const chosen = parseSurface(input.viewCookie)
  if (chosen) {
    return {
      surface: chosen,
      proxyToMobile: chosen === "mobile",
      setViewCookie: null,
      setSurfaceCookie: input.isDocumentRequest ? chosen : null,
      reason: "view-cookie",
    }
  }

  const surface: AppSurface = isPhoneUserAgent(input.userAgent) ? "mobile" : "desktop"
  return {
    surface,
    proxyToMobile: surface === "mobile",
    setViewCookie: null,
    setSurfaceCookie: input.isDocumentRequest ? surface : null,
    reason: "user-agent",
  }
}

/**
 * Origin of the mobile PWA, or null when it is not separately hosted.
 *
 * Returns null when the ports match, because then a single app is serving both
 * and there is nothing to proxy to.
 */
export function resolveMobileSurfaceOrigin(env: {
  mobileOrigin?: string | null
  mobilePort?: string | null
  webPort?: string | null
}): string | null {
  const explicit = env.mobileOrigin?.trim().replace(/\/+$/, "")
  if (explicit) return explicit

  const mobilePort = env.mobilePort?.trim()
  if (!mobilePort) return null
  if (mobilePort === env.webPort?.trim()) return null

  return `http://127.0.0.1:${mobilePort}`
}
