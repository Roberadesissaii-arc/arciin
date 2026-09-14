import { describe, expect, it } from "vitest"

import {
  ARCIIN_WINDOWS_DESKTOP_DOWNLOAD_URL,
  DESKTOP_PROMO_DISMISSED_KEY,
  dismissDesktopPromo,
  isDesktopPromoDismissed,
  isWindowsBrowserPlatform,
  shouldOfferWindowsDesktopDownload,
  shouldShowWindowsDesktopPromo,
} from "@arciin/shared"

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
const LINUX_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
const WINDOWS_PHONE_UA =
  "Mozilla/5.0 (Windows Phone 10.0; Android 6.0; WebView/3.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.102 Mobile Safari/537.36 Edge/18.19041"

describe("canonical Windows Desktop download URL", () => {
  it("is the stable public website path, not a versioned installer", () => {
    expect(ARCIIN_WINDOWS_DESKTOP_DOWNLOAD_URL).toBe(
      "https://www.arciin.com/download/windows",
    )
    expect(ARCIIN_WINDOWS_DESKTOP_DOWNLOAD_URL).not.toMatch(/\.exe/i)
    expect(ARCIIN_WINDOWS_DESKTOP_DOWNLOAD_URL).not.toMatch(/github\.com/i)
    expect(ARCIIN_WINDOWS_DESKTOP_DOWNLOAD_URL).not.toMatch(/releases\/download/i)
    expect(ARCIIN_WINDOWS_DESKTOP_DOWNLOAD_URL).not.toMatch(/[?#]/)
    expect(ARCIIN_WINDOWS_DESKTOP_DOWNLOAD_URL).not.toMatch(
      /code|token|session|cookie|password|secret|user.?id|192\.168|pairing/i,
    )
  })
})

describe("isWindowsBrowserPlatform", () => {
  it("prefers Client Hints over the user agent", () => {
    expect(
      isWindowsBrowserPlatform({
        userAgentDataPlatform: "Windows",
        userAgent: LINUX_UA,
      }),
    ).toBe(true)
    expect(
      isWindowsBrowserPlatform({
        userAgentDataPlatform: "macOS",
        userAgent: WINDOWS_UA,
      }),
    ).toBe(false)
  })

  it("falls back conservatively to the user agent", () => {
    expect(isWindowsBrowserPlatform({ userAgent: WINDOWS_UA })).toBe(true)
    expect(isWindowsBrowserPlatform({ userAgent: MAC_UA })).toBe(false)
    expect(isWindowsBrowserPlatform({ userAgent: LINUX_UA })).toBe(false)
    expect(isWindowsBrowserPlatform({ userAgent: ANDROID_UA })).toBe(false)
    expect(isWindowsBrowserPlatform({ userAgent: WINDOWS_PHONE_UA })).toBe(false)
    expect(isWindowsBrowserPlatform({ userAgent: "" })).toBe(false)
    expect(isWindowsBrowserPlatform({})).toBe(false)
  })
})

describe("Windows Desktop promotion gates", () => {
  it("shows in a normal Windows browser", () => {
    expect(
      shouldShowWindowsDesktopPromo({
        userAgent: WINDOWS_UA,
        isDesktopWebView: false,
        dismissed: false,
        pathname: "/dashboard",
      }),
    ).toBe(true)
  })

  it("never shows inside Arciin Desktop WebView", () => {
    expect(
      shouldShowWindowsDesktopPromo({
        userAgent: WINDOWS_UA,
        isDesktopWebView: true,
        dismissed: false,
        pathname: "/dashboard",
      }),
    ).toBe(false)
    expect(
      shouldOfferWindowsDesktopDownload({
        userAgentDataPlatform: "Windows",
        isDesktopWebView: true,
      }),
    ).toBe(false)
  })

  it("does not auto-appear on Linux or macOS", () => {
    expect(
      shouldShowWindowsDesktopPromo({ userAgent: LINUX_UA, pathname: "/dashboard" }),
    ).toBe(false)
    expect(
      shouldShowWindowsDesktopPromo({ userAgent: MAC_UA, pathname: "/dashboard" }),
    ).toBe(false)
  })

  it("stays off after Continue in browser", () => {
    expect(
      shouldShowWindowsDesktopPromo({
        userAgent: WINDOWS_UA,
        dismissed: true,
        pathname: "/files",
      }),
    ).toBe(false)
  })

  it("does not stack on the post-claim setup screen", () => {
    expect(
      shouldShowWindowsDesktopPromo({
        userAgent: WINDOWS_UA,
        pathname: "/setup/complete",
      }),
    ).toBe(false)
  })

  it("still offers Settings download after dismissal, on Windows only", () => {
    expect(
      shouldOfferWindowsDesktopDownload({
        userAgent: WINDOWS_UA,
        dismissed: true,
        isDesktopWebView: false,
      }),
    ).toBe(true)
    expect(shouldOfferWindowsDesktopDownload({ userAgent: LINUX_UA })).toBe(false)
    expect(shouldOfferWindowsDesktopDownload({ userAgent: MAC_UA })).toBe(false)
  })
})

describe("dismissal persistence", () => {
  it("uses the suggested non-sensitive local preference key", () => {
    expect(DESKTOP_PROMO_DISMISSED_KEY).toBe("arciin:desktop-promo-dismissed:v1")
    const store = new Map<string, string>()
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    }
    expect(isDesktopPromoDismissed(storage)).toBe(false)
    dismissDesktopPromo(storage)
    expect(isDesktopPromoDismissed(storage)).toBe(true)
    expect(store.get(DESKTOP_PROMO_DISMISSED_KEY)).toBe("1")
  })
})
