import {
  dismissDesktopPromo,
  isDesktopPromoDismissed,
  isArciinDesktopWebView,
  type DesktopPromoHints,
} from "@arciin/shared"

type NavigatorWithHints = Navigator & {
  userAgentData?: { platform?: string }
}

export function readDesktopPromoHints(pathname?: string | null): DesktopPromoHints {
  if (typeof window === "undefined") {
    return { dismissed: true, isDesktopWebView: false, pathname }
  }

  const uaData = (window.navigator as NavigatorWithHints).userAgentData
  return {
    userAgentDataPlatform: uaData?.platform ?? null,
    userAgent: window.navigator.userAgent,
    isDesktopWebView: isArciinDesktopWebView(),
    dismissed: isDesktopPromoDismissed(window.localStorage),
    pathname,
  }
}

export function persistDesktopPromoDismissed() {
  if (typeof window === "undefined") return
  try {
    dismissDesktopPromo(window.localStorage)
  } catch {
    // Private mode / blocked storage: the next visit may show the prompt again.
  }
}
