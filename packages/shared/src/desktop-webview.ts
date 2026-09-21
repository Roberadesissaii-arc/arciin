/**
 * Whether the page is running inside Arciin Desktop's WebView.
 *
 * This is all that survives of the old native bridge: the rest of that module
 * existed to hand Computer Backup setup over to the native app, and went with
 * the feature. Desktop still loads the web app in a WebView, and the UI still
 * wants to know — to offer the Windows download to browser visitors and not to
 * people already running it.
 */
type ChromeWebViewHost = Window & {
  chrome?: { webview?: unknown }
}

/** UI-only: chrome.webview is present. Never use this for security. */
export function isArciinDesktopWebView(): boolean {
  if (typeof window === "undefined") return false
  return Boolean((window as ChromeWebViewHost).chrome?.webview)
}
