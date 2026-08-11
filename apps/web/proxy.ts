import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

import {
  SURFACE_COOKIE,
  SURFACE_QUERY_PARAM,
  VIEW_COOKIE,
  decideAppSurface,
  resolveMobileSurfaceOrigin,
} from "@arciin/shared"

/**
 * One domain, two apps.
 *
 * Next 16 renamed the `middleware` file convention to `proxy`; this file must
 * be named proxy.ts and export `proxy`, or it silently never runs.
 *
 * Arciin can only ever run a single Cloudflare quick tunnel — the cloudflared
 * child process is a module-level singleton, and starting a second one stops
 * the first. So a domain generated for the mobile PWA took the desktop app's
 * domain away, and vice versa.
 *
 * Rather than fight that, one tunnel now points at this app and this proxy
 * decides per request which of the two apps should answer. Phones are proxied
 * through to the mobile PWA on its own port; everything else is served here.
 *
 * The routing rules live in `@arciin/shared/app-surface` so they are unit
 * tested without a running Next server. The one that is easy to miss: assets
 * follow the app that served their page, not the user agent — otherwise a
 * share link opened on a phone renders blank, because the HTML comes from this
 * app and its `/_next/*` bundles would be fetched from the other one.
 */

const MOBILE_ORIGIN = resolveMobileSurfaceOrigin({
  mobileOrigin: process.env.ARCIIN_MOBILE_ORIGIN,
  mobilePort: process.env.ARCIIN_MOBILE_PORT,
  webPort: process.env.ARCIIN_WEB_PORT ?? process.env.PORT,
})

/** Escape hatch: set ARCIIN_UNIFIED_DOMAIN=false to serve only the desktop app. */
const UNIFIED_DOMAIN_ENABLED = process.env.ARCIIN_UNIFIED_DOMAIN !== "false"

const VIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
/** Only needs to outlive the page it describes. */
const SURFACE_COOKIE_MAX_AGE = 60 * 60 * 24

/**
 * Whether this is a top-level navigation rather than a sub-resource.
 *
 * `Sec-Fetch-Dest` is sent by every current browser; the Accept check is the
 * fallback for clients that omit it (and for curl, which makes this testable).
 */
function isDocumentRequest(request: NextRequest): boolean {
  const dest = request.headers.get("sec-fetch-dest")
  if (dest) return dest === "document"
  return (request.headers.get("accept") ?? "").includes("text/html")
}

export function proxy(request: NextRequest) {
  const mobileAvailable = Boolean(MOBILE_ORIGIN) && UNIFIED_DOMAIN_ENABLED

  const decision = decideAppSurface({
    pathname: request.nextUrl.pathname,
    userAgent: request.headers.get("user-agent"),
    viewCookie: request.cookies.get(VIEW_COOKIE)?.value ?? null,
    surfaceCookie: request.cookies.get(SURFACE_COOKIE)?.value ?? null,
    queryOverride: request.nextUrl.searchParams.get(SURFACE_QUERY_PARAM),
    isDocumentRequest: isDocumentRequest(request),
    mobileAvailable,
  })

  const response = (() => {
    if (!decision.proxyToMobile || !MOBILE_ORIGIN) {
      return NextResponse.next()
    }

    // Preserve path and query exactly; only the origin changes. Using
    // NextResponse.rewrite rather than a hand-rolled fetch matters here — Next
    // propagates the RSC headers upstream for us.
    const target = new URL(
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
      MOBILE_ORIGIN,
    )
    return NextResponse.rewrite(target)
  })()

  if (decision.setViewCookie) {
    response.cookies.set(VIEW_COOKIE, decision.setViewCookie, {
      path: "/",
      maxAge: VIEW_COOKIE_MAX_AGE,
      sameSite: "lax",
      // Readable by client code so the UI can show which view is active. It
      // carries no credential — only a layout preference.
      httpOnly: false,
    })
  }

  if (decision.setSurfaceCookie) {
    response.cookies.set(SURFACE_COOKIE, decision.setSurfaceCookie, {
      path: "/",
      maxAge: SURFACE_COOKIE_MAX_AGE,
      sameSite: "lax",
      httpOnly: false,
    })
  }

  response.headers.set("x-arciin-surface", decision.surface)

  // Two apps answer on this hostname and their responses differ by device and
  // by cookie. Without this a shared cache could hand one app's HTML to a
  // client expecting the other's.
  const existingVary = response.headers.get("vary")
  response.headers.set(
    "vary",
    existingVary ? `${existingVary}, User-Agent, Cookie` : "User-Agent, Cookie",
  )

  return response
}

export const config = {
  matcher: ["/((?!_next/webpack-hmr|__nextjs).*)"],
}
