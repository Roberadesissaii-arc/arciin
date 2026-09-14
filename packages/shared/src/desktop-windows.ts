/**
 * Windows Desktop acquisition — UI selection only.
 *
 * The public website owns the current installer. This module never names a
 * versioned .exe, GitHub release asset, or CDN object. Detection of Windows
 * or of Arciin Desktop's WebView is not a security boundary.
 */

/** Stable public URL. Future Desktop releases must not require a server update. */
export const ARCIIN_WINDOWS_DESKTOP_DOWNLOAD_URL =
  "https://www.arciin.com/download/windows"

/** Browser-local dismissal. Not a database record and not a secret. */
export const DESKTOP_PROMO_DISMISSED_KEY = "arciin:desktop-promo-dismissed:v1"

export type DesktopPromoHints = {
  /** Client Hints `navigator.userAgentData.platform` when present. */
  userAgentDataPlatform?: string | null
  userAgent?: string | null
  /** UI-only: `chrome.webview` from Arciin Desktop. Never use for auth. */
  isDesktopWebView?: boolean
  dismissed?: boolean
  /** Pathname so setup-complete is not stacked with another prompt. */
  pathname?: string | null
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ""
}

/**
 * Conservative Windows detection for UX. Client Hints win when present;
 * otherwise a UA token. Phones are excluded. Not a security check.
 */
export function isWindowsBrowserPlatform(input: {
  userAgentDataPlatform?: string | null
  userAgent?: string | null
}): boolean {
  const ua = input.userAgent ?? ""
  // A concrete non-Windows UA wins over Client Hints. Playwright on Linux can
  // still report platform "Windows" while a test sets a Linux/macOS UA.
  if (ua) {
    if (/windows phone|iemobile/i.test(ua)) return false
    if (/\b(android|iphone|ipod|ipad)\b/i.test(ua)) return false
    if (/\b(macintosh|mac os x)\b/i.test(ua)) return false
    if (/\b(x11|linux|cros)\b/i.test(ua) && !/windows/i.test(ua)) return false
  }

  const hinted = normalize(input.userAgentDataPlatform)
  if (hinted) {
    if (
      hinted === "android" ||
      hinted === "ios" ||
      hinted.includes("iphone") ||
      hinted === "macos" ||
      hinted === "linux"
    ) {
      return false
    }
    return hinted === "windows" || hinted === "win32"
  }

  if (!ua) return false
  return /windows nt|win64|wow64|\bwindows\b/i.test(ua)
}

export function isDesktopPromoDismissed(storage: {
  getItem(key: string): string | null
}): boolean {
  try {
    return storage.getItem(DESKTOP_PROMO_DISMISSED_KEY) === "1"
  } catch {
    return true
  }
}

export function dismissDesktopPromo(storage: { setItem(key: string, value: string): void }): void {
  storage.setItem(DESKTOP_PROMO_DISMISSED_KEY, "1")
}

/**
 * One-time Windows browser prompt. Hidden inside Arciin Desktop, on phones,
 * after local dismissal, and on the post-claim setup-complete screen.
 */
export function shouldShowWindowsDesktopPromo(input: DesktopPromoHints): boolean {
  if (input.isDesktopWebView) return false
  if (input.dismissed) return false
  if (input.pathname?.startsWith("/setup")) return false
  if (!isWindowsBrowserPlatform(input)) return false
  return true
}

/** Permanent Settings entry: Windows browser only, never inside Desktop. */
export function shouldOfferWindowsDesktopDownload(input: DesktopPromoHints): boolean {
  if (input.isDesktopWebView) return false
  return isWindowsBrowserPlatform(input)
}
