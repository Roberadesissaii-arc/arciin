import { readFileSync } from "node:fs"
import path from "node:path"

import { expect, test as setup, type Page } from "@playwright/test"

import { DESKTOP_PROMO_DISMISSED_KEY, suppressWindowsDesktopPromo } from "./desktop-promo"

/**
 * Sign in once and save the session for the browser suite.
 *
 * Without this the app redirects every test to /login, and the "no paywall"
 * assertions would pass while proving nothing — which is exactly what the
 * first run did before `expectChatPageRendered` caught it.
 *
 * Credentials belong to the seeded **dev** instance only (arciin_dev). The
 * password is generated per-run and read from a 0600 file; it is never a
 * production credential and never appears in the repository or the log.
 */

/**
 * Kept out of `test-results/`.
 *
 * That directory is Playwright's `outputDir`: it owns it, and it removes and
 * recreates paths under it as artifacts are written. The shared session used to
 * live at `test-results/.auth/`, so a run could sweep it away part-way through
 * — after which every remaining test failed in single-digit milliseconds with
 * `ENOENT ... e2e-user.json` rather than anything to do with the test. Storing
 * shared state inside a directory another tool manages is the bug; moving it
 * out is the fix.
 */
export const STORAGE_STATE = path.resolve(process.cwd(), ".playwright-auth/e2e-user.json")

const EMAIL = "e2e@arciin.invalid"
const PASSWORD_FILE = "/tmp/arciin-e2e-pw"

setup("authenticate against the isolated dev instance", async ({ page, context }) => {
  const password = readFileSync(PASSWORD_FILE, "utf8").trim()
  await suppressWindowsDesktopPromo(context)

  await page.goto("/login")

  // A previous run may have left a valid session cookie, in which case /login
  // redirects straight to the dashboard and there is no form to fill. The old
  // code waited 120s for an email input that was never going to appear and
  // reported it as a selector problem. Signing in is only needed when we are
  // actually signed out.
  const emailField = page.locator('input[type="email"]')
  const alreadySignedIn = await emailField
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => false)
    .catch(() => !page.url().includes("/login"))

  if (alreadySignedIn) {
    await persistDesktopPromoDismissal(page)
    await context.storageState({ path: STORAGE_STATE })
    return
  }

  // Placeholder selectors: the login inputs are not wired to <label for>, so
  // getByLabel does not resolve them.
  await emailField.fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(password)
  await page.getByRole("button", { name: /sign in|log in|continue/i }).first().click()

  // The redirect away from /login is the signal that the session took.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
  expect(page.url(), "login should leave /login").not.toContain("/login")

  await persistDesktopPromoDismissal(page)
  await context.storageState({ path: STORAGE_STATE })
})

async function persistDesktopPromoDismissal(page: Page) {
  await page.evaluate((key) => {
    window.localStorage.setItem(key, "1")
  }, DESKTOP_PROMO_DISMISSED_KEY)
}
