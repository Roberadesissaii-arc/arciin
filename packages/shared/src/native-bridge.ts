/**
 * Narrow Arciin Desktop native intent for computer-backup setup.
 *
 * Desktop's navigation guard intercepts this exact sentinel and opens Protect
 * Folders. The web UI only emits that URL. It never carries credentials,
 * cookies, paths, or user-controlled input. Detection of the WebView is UI
 * transport selection only — Desktop validates the sentinel itself.
 */

export const ARCIIN_NATIVE_BACKUP_SETUP_URL = "arciin-native://backup/setup"

export const COMPUTER_BACKUP_DESKTOP_HINT =
  "Choose which folders to protect from this PC."
export const COMPUTER_BACKUP_BROWSER_HINT =
  "Open Arciin Desktop to protect folders."

type ChromeWebViewHost = Window & {
  chrome?: { webview?: unknown }
  __arciinNativeBackupSetupIntent?: string
}

/** UI-only: chrome.webview is present. Never use this for security. */
export function isArciinDesktopWebView(): boolean {
  if (typeof window === "undefined") return false
  return Boolean((window as ChromeWebViewHost).chrome?.webview)
}

export function computerBackupEmptyHint(inDesktop: boolean): string {
  return inDesktop ? COMPUTER_BACKUP_DESKTOP_HINT : COMPUTER_BACKUP_BROWSER_HINT
}

/**
 * Asks Desktop to open Protect Folders via the allowlisted sentinel.
 * Returns false in a normal browser so the caller can fall back.
 * Accepts no URL, action, or other arguments.
 */
export function requestNativeComputerBackupSetup(): boolean {
  if (!isArciinDesktopWebView()) return false
  const host = window as ChromeWebViewHost
  host.__arciinNativeBackupSetupIntent = ARCIIN_NATIVE_BACKUP_SETUP_URL
  host.location.assign(ARCIIN_NATIVE_BACKUP_SETUP_URL)
  return true
}
