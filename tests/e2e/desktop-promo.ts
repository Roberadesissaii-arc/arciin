import type { BrowserContext } from "@playwright/test"

/** Same key the app persists. Keep the string here so e2e does not import app modules. */
export const DESKTOP_PROMO_DISMISSED_KEY = "arciin:desktop-promo-dismissed:v1"

/**
 * Playwright's Desktop Chrome device reports a Windows platform, so the
 * one-time Desktop prompt would cover every authenticated spec. Opt-in
 * Windows coverage lives in desktop-download-prompt.spec.ts with its own
 * context.
 */
export async function suppressWindowsDesktopPromo(context: BrowserContext) {
  await context.addInitScript((key: string) => {
    try {
      window.localStorage.setItem(key, "1")
    } catch {
      // Private mode in tests still needs the rest of the suite to run.
    }
  }, DESKTOP_PROMO_DISMISSED_KEY)
}
