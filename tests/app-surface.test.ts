import { describe, expect, it } from "vitest"

import {
  decideAppSurface,
  isAssetPath,
  isDesktopOnlyPath,
  isPhoneUserAgent,
  resolveMobileSurfaceOrigin,
} from "@arciin/shared"

/**
 * One tunnel, two apps.
 *
 * Only one cloudflared process can exist at a time, so generating a domain for
 * the mobile PWA used to kill the desktop one. These tests pin the routing that
 * replaced it: a single domain that picks the app per request.
 */

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1"
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

const base = { mobileAvailable: true, isDocumentRequest: true }
const asset = { mobileAvailable: true, isDocumentRequest: false }

describe("isPhoneUserAgent", () => {
  it("recognises phones", () => {
    expect(isPhoneUserAgent(IPHONE)).toBe(true)
    expect(isPhoneUserAgent(ANDROID_PHONE)).toBe(true)
  })

  it("treats tablets and desktops as desktop", () => {
    // The desktop app is the responsive one; a tablet is better served by it.
    expect(isPhoneUserAgent(ANDROID_TABLET)).toBe(false)
    expect(isPhoneUserAgent(IPAD)).toBe(false)
    expect(isPhoneUserAgent(MAC)).toBe(false)
  })

  it("falls back to desktop for an unknown or missing agent", () => {
    expect(isPhoneUserAgent(null)).toBe(false)
    expect(isPhoneUserAgent("")).toBe(false)
    expect(isPhoneUserAgent("curl/8.5.0")).toBe(false)
  })

  it("does not mistake an Android tablet for a phone on the word android alone", () => {
    expect(isPhoneUserAgent("Mozilla/5.0 (Linux; Android 14; Tab)")).toBe(false)
  })
})

describe("isDesktopOnlyPath", () => {
  it("keeps the API and socket on the desktop app", () => {
    // Routing these through the mobile app adds a hop and loses the client IP.
    expect(isDesktopOnlyPath("/api/health")).toBe(true)
    expect(isDesktopOnlyPath("/socket.io/")).toBe(true)
  })

  it("keeps public share and upload links on the desktop app", () => {
    // These routes exist only in the desktop app. Device-routing them would
    // 404 exactly the people the link was sent to.
    expect(isDesktopOnlyPath("/s/abc123")).toBe(true)
    expect(isDesktopOnlyPath("/request/frq_abc")).toBe(true)
  })

  it("does not capture unrelated paths that merely start with the same letters", () => {
    expect(isDesktopOnlyPath("/settings")).toBe(false)
    expect(isDesktopOnlyPath("/search")).toBe(false)
    expect(isDesktopOnlyPath("/requests")).toBe(false)
    expect(isDesktopOnlyPath("/apikeys")).toBe(false)
  })

  it("routes ordinary app paths by device", () => {
    expect(isDesktopOnlyPath("/dashboard")).toBe(false)
    expect(isDesktopOnlyPath("/_next/static/chunk.js")).toBe(false)
  })
})

describe("decideAppSurface", () => {
  it("sends a phone to the mobile app", () => {
    const decision = decideAppSurface({ ...base, pathname: "/", userAgent: IPHONE })
    expect(decision).toMatchObject({ surface: "mobile", proxyToMobile: true, reason: "user-agent" })
  })

  it("sends a desktop browser to the desktop app", () => {
    expect(
      decideAppSurface({ ...base, pathname: "/", userAgent: MAC }),
    ).toMatchObject({ surface: "desktop", proxyToMobile: false })
  })

  it("keeps a phone's asset requests on the mobile app once it served the page", () => {
    // Both apps serve their own /_next bundles. A client that got mobile HTML
    // must get mobile assets, or the page loads against the wrong build.
    expect(
      decideAppSurface({
        ...asset,
        pathname: "/_next/static/chunks/main.js",
        userAgent: IPHONE,
        surfaceCookie: "mobile",
      }).surface,
    ).toBe("mobile")
  })

  it("serves a share link from the desktop app even on a phone", () => {
    const decision = decideAppSurface({ ...base, pathname: "/s/tok", userAgent: IPHONE })
    expect(decision).toMatchObject({ surface: "desktop", reason: "shared-path" })
  })

  it("serves a file request link from the desktop app even on a phone", () => {
    expect(
      decideAppSurface({ ...base, pathname: "/request/tok", userAgent: ANDROID_PHONE }).surface,
    ).toBe("desktop")
  })

  it("keeps the API on desktop even when a cookie says mobile", () => {
    // The shared-path rule is checked first precisely so no client state can
    // redirect API traffic.
    expect(
      decideAppSurface({
        ...base,
        pathname: "/api/uploads",
        userAgent: IPHONE,
        viewCookie: "mobile",
        surfaceCookie: "mobile",
      }).surface,
    ).toBe("desktop")
  })

  it("honours an explicit ?view= override and remembers it", () => {
    const desktopOnPhone = decideAppSurface({
      ...base,
      pathname: "/",
      userAgent: IPHONE,
      queryOverride: "desktop",
    })
    expect(desktopOnPhone).toMatchObject({
      surface: "desktop",
      proxyToMobile: false,
      setViewCookie: "desktop",
    })

    const mobileOnDesktop = decideAppSurface({
      ...base,
      pathname: "/",
      userAgent: MAC,
      queryOverride: "mobile",
    })
    expect(mobileOnDesktop).toMatchObject({ surface: "mobile", setViewCookie: "mobile" })
  })

  it("prefers the override over an existing cookie", () => {
    expect(
      decideAppSurface({
        ...base,
        pathname: "/",
        userAgent: IPHONE,
        viewCookie: "mobile",
        queryOverride: "desktop",
      }).surface,
    ).toBe("desktop")
  })

  it("uses the cookie over the user agent", () => {
    expect(
      decideAppSurface({ ...base, pathname: "/", userAgent: IPHONE, viewCookie: "desktop" }),
    ).toMatchObject({ surface: "desktop", reason: "view-cookie" })
  })

  it("ignores a malformed cookie or override", () => {
    expect(
      decideAppSurface({
        ...base,
        pathname: "/",
        userAgent: IPHONE,
        viewCookie: "../../etc",
        queryOverride: "nonsense",
      }),
    ).toMatchObject({ surface: "mobile", reason: "user-agent" })
  })

  it("does not record an explicit choice for plain agent detection", () => {
    // Otherwise every crawler and health check looks like a deliberate override.
    expect(decideAppSurface({ ...base, pathname: "/", userAgent: IPHONE }).setViewCookie).toBeNull()
  })

  it("falls back to desktop entirely when no mobile app is configured", () => {
    const decision = decideAppSurface({
      pathname: "/",
      userAgent: IPHONE,
      isDocumentRequest: true,
      mobileAvailable: false,
    })
    expect(decision).toMatchObject({
      surface: "desktop",
      proxyToMobile: false,
      reason: "mobile-unavailable",
    })
  })

  it("ignores even an explicit mobile override when mobile is unavailable", () => {
    // A missing mobile app must degrade to "the site works", never to a 502.
    expect(
      decideAppSurface({
        pathname: "/",
        userAgent: IPHONE,
        queryOverride: "mobile",
        isDocumentRequest: true,
        mobileAvailable: false,
      }).proxyToMobile,
    ).toBe(false)
  })
})

describe("resolveMobileSurfaceOrigin", () => {
  it("uses an explicit origin when given", () => {
    expect(
      resolveMobileSurfaceOrigin({ mobileOrigin: "http://127.0.0.1:3003/" }),
    ).toBe("http://127.0.0.1:3003")
  })

  it("derives a loopback origin from the mobile port", () => {
    expect(resolveMobileSurfaceOrigin({ mobilePort: "3003", webPort: "3002" })).toBe(
      "http://127.0.0.1:3003",
    )
  })

  it("returns null when both apps share a port — nothing to proxy to", () => {
    expect(resolveMobileSurfaceOrigin({ mobilePort: "3002", webPort: "3002" })).toBeNull()
  })

  it("returns null when the mobile app is not configured", () => {
    expect(resolveMobileSurfaceOrigin({ webPort: "3002" })).toBeNull()
    expect(resolveMobileSurfaceOrigin({})).toBeNull()
  })
})

describe("assets follow their page, not the device (the blank-share-page bug)", () => {
  // A share link opened on a phone is served by the DESKTOP app, because only
  // it has /s/. Routing that page's /_next bundles by user agent sent them to
  // the mobile app, which 404s them, and the share rendered blank.

  it("records which app served a document so its assets can follow", () => {
    const sharePage = decideAppSurface({ ...base, pathname: "/s/tok", userAgent: IPHONE })
    expect(sharePage.setSurfaceCookie).toBe("desktop")

    const mobileHome = decideAppSurface({ ...base, pathname: "/", userAgent: IPHONE })
    expect(mobileHome.setSurfaceCookie).toBe("mobile")
  })

  it("serves desktop assets to a phone that is on a desktop-served share page", () => {
    const decision = decideAppSurface({
      ...asset,
      pathname: "/_next/static/chunks/0kf.js",
      userAgent: IPHONE,
      surfaceCookie: "desktop",
    })
    expect(decision).toMatchObject({
      surface: "desktop",
      proxyToMobile: false,
      reason: "asset-follows-page",
    })
  })

  it("does not let the recorded surface hijack the NEXT navigation", () => {
    // After reading a share on desktop assets, the phone opening the app itself
    // must still get the mobile UI — the surface cookie is not a preference.
    expect(
      decideAppSurface({ ...base, pathname: "/", userAgent: IPHONE, surfaceCookie: "desktop" }),
    ).toMatchObject({ surface: "mobile", reason: "user-agent" })
  })

  it("still honours a real user override on a document", () => {
    expect(
      decideAppSurface({
        ...base,
        pathname: "/",
        userAgent: IPHONE,
        surfaceCookie: "mobile",
        viewCookie: "desktop",
      }).surface,
    ).toBe("desktop")
  })

  it("re-establishes a desktop surface cookie when desktop view is explicit", () => {
    const decision = decideAppSurface({
      ...base,
      pathname: "/dashboard",
      userAgent: MAC,
      viewCookie: "desktop",
      surfaceCookie: "mobile",
    })
    expect(decision).toMatchObject({
      surface: "desktop",
      proxyToMobile: false,
      setSurfaceCookie: "desktop",
      reason: "view-cookie",
    })
  })

  it("does not let a stale mobile surface cookie poison desktop assets", () => {
    const decision = decideAppSurface({
      ...asset,
      pathname: "/_next/static/chunks/main.js",
      userAgent: MAC,
      viewCookie: "desktop",
      surfaceCookie: "mobile",
    })
    expect(decision).toMatchObject({
      surface: "desktop",
      proxyToMobile: false,
      reason: "view-heals-surface",
    })
  })

  it("heals desktop assets when ?view=desktop is explicit", () => {
    expect(
      decideAppSurface({
        ...asset,
        pathname: "/_next/static/chunks/main.js",
        userAgent: MAC,
        queryOverride: "desktop",
        surfaceCookie: "mobile",
      }),
    ).toMatchObject({
      surface: "desktop",
      proxyToMobile: false,
      reason: "view-heals-surface",
    })
  })

  it("still follows a recorded desktop surface when view is mobile", () => {
    // Share-on-phone: HTML came from desktop; leftover view=mobile must not
    // yank /_next bundles over to the mobile app.
    expect(
      decideAppSurface({
        ...asset,
        pathname: "/_next/static/chunks/main.js",
        userAgent: IPHONE,
        viewCookie: "mobile",
        surfaceCookie: "desktop",
      }),
    ).toMatchObject({
      surface: "desktop",
      reason: "asset-follows-page",
    })
  })

  it("falls back to the user agent for assets when no surface was recorded", () => {
    // First paint, or a client that blocks cookies.
    expect(
      decideAppSurface({ ...asset, pathname: "/_next/static/x.js", userAgent: IPHONE }),
    ).toMatchObject({ surface: "mobile", reason: "user-agent" })
  })

  it("never writes the surface cookie on an asset response", () => {
    expect(
      decideAppSurface({ ...asset, pathname: "/_next/static/x.js", userAgent: IPHONE })
        .setSurfaceCookie,
    ).toBeNull()
  })

  it("identifies asset paths", () => {
    expect(isAssetPath("/_next/static/chunks/main.js")).toBe(true)
    expect(isAssetPath("/dashboard")).toBe(false)
  })
})
