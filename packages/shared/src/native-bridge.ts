/**
 * Narrow WebView2 bridge for Arciin Desktop.
 *
 * The web app may emit exactly one allowlisted intent. Desktop verifies the
 * WebView origin and ignores every unknown action. This module never carries
 * credentials, cookies, paths, or shell commands.
 */

export const ARCIIN_NATIVE_MESSAGE_TYPE = "ARCIIN_NATIVE_ACTION"
export const ARCIIN_NATIVE_PROTOCOL_VERSION = 1
export const OPEN_COMPUTER_BACKUP_SETUP = "OPEN_COMPUTER_BACKUP_SETUP"

export const ARCIIN_NATIVE_ACTIONS = [OPEN_COMPUTER_BACKUP_SETUP] as const

export type ArciinNativeAction = (typeof ARCIIN_NATIVE_ACTIONS)[number]

export type ArciinNativeMessage = {
  type: typeof ARCIIN_NATIVE_MESSAGE_TYPE
  version: typeof ARCIIN_NATIVE_PROTOCOL_VERSION
  action: ArciinNativeAction
}

export function createComputerBackupSetupAction(): ArciinNativeMessage {
  return {
    type: ARCIIN_NATIVE_MESSAGE_TYPE,
    version: ARCIIN_NATIVE_PROTOCOL_VERSION,
    action: OPEN_COMPUTER_BACKUP_SETUP,
  }
}

export function nativeMessageHasSecrets(message: ArciinNativeMessage): boolean {
  const keys = Object.keys(message)
  return (
    keys.length !== 3 ||
    !("type" in message) ||
    !("version" in message) ||
    !("action" in message)
  )
}

type WebViewBridge = {
  postMessage?: (message: unknown) => void
}

function webViewBridge(): WebViewBridge | null {
  if (typeof window === "undefined") return null
  const chrome = (window as Window & { chrome?: { webview?: WebViewBridge } }).chrome
  return chrome?.webview ?? null
}

/**
 * Posts OPEN_COMPUTER_BACKUP_SETUP when a WebView2 bridge exists.
 * Returns false in a normal browser so the caller can fall back.
 */
export function requestNativeComputerBackupSetup(): boolean {
  const post = webViewBridge()?.postMessage
  if (typeof post !== "function") return false
  post(createComputerBackupSetupAction())
  return true
}
