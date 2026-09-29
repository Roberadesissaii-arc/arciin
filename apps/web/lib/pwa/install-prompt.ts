/**
 * When Arciin offers to install itself, and when it stops.
 *
 * Chrome fires `beforeinstallprompt` more than once in a page's life — again
 * after client-side navigations and whenever it re-evaluates installability.
 * The prompt used to read the dismissal only when it mounted, and it mounts
 * once in the app providers, so every later event re-opened it: "Not now"
 * lasted until the next page. The decision now happens at event time, every
 * time, and a dismissal also drops the held event.
 *
 * Policy: X or "Not now" means this browser is not asked again on this origin.
 * The browser's own install control still works.
 */

export const INSTALL_DISMISS_KEY = "arciin.install-dismissed"

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

type StorageLike = Pick<Storage, "getItem" | "setItem">

/**
 * Dismissal for this page load, whatever storage does.
 *
 * If localStorage is missing or throws (a private window, blocked site data),
 * the answer still has to hold until the page is reloaded, including across a
 * remount of the prompt.
 */
export type DismissMemory = { dismissed: boolean }

const pageMemory: DismissMemory = { dismissed: false }

/** `window.localStorage` itself can throw a SecurityError just by being read. */
function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage
  } catch {
    return null
  }
}

export function isInstallPromptDismissed(
  storage: StorageLike | null = browserStorage(),
  memory: DismissMemory = pageMemory,
): boolean {
  if (memory.dismissed) return true
  try {
    return storage?.getItem(INSTALL_DISMISS_KEY) === "1"
  } catch {
    return false
  }
}

export function persistInstallPromptDismissal(
  storage: StorageLike | null = browserStorage(),
  memory: DismissMemory = pageMemory,
): void {
  memory.dismissed = true
  try {
    storage?.setItem(INSTALL_DISMISS_KEY, "1")
  } catch {
    // The in-memory flag above still stops this page asking again.
  }
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export type InstallPromptState = {
  visible: boolean
  deferred: BeforeInstallPromptEvent | null
}

export const HIDDEN_INSTALL_PROMPT: InstallPromptState = { visible: false, deferred: null }

export type InstallPromptController = {
  handleBeforeInstall: (event: Event) => void
  handleInstalled: () => void
  dismiss: () => void
}

export function createInstallPromptController(options: {
  onChange: (state: InstallPromptState) => void
  storage?: StorageLike | null
  memory?: DismissMemory
  isStandalone?: () => boolean
}): InstallPromptController {
  const { onChange, memory = pageMemory, isStandalone = isStandaloneDisplay } = options
  const storage = options.storage === undefined ? browserStorage() : options.storage

  return {
    handleBeforeInstall(event) {
      // Always: without this Chrome shows its own mini-infobar, which would be
      // the same nag in a different place once the owner has said no.
      event.preventDefault()
      if (isStandalone() || isInstallPromptDismissed(storage, memory)) {
        onChange(HIDDEN_INSTALL_PROMPT)
        return
      }
      onChange({ visible: true, deferred: event as BeforeInstallPromptEvent })
    },
    handleInstalled() {
      onChange(HIDDEN_INSTALL_PROMPT)
    },
    dismiss() {
      onChange(HIDDEN_INSTALL_PROMPT)
      persistInstallPromptDismissal(storage, memory)
    },
  }
}
