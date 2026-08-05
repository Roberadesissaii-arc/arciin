import { readFileSync } from "node:fs"
import path from "node:path"

import { expect, test as setup } from "@playwright/test"

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

export const STORAGE_STATE = path.resolve(process.cwd(), "test-results/.auth/e2e-user.json")

const EMAIL = "e2e@arciin.invalid"
const PASSWORD_FILE = "/tmp/arciin-e2e-pw"

setup("authenticate against the isolated dev instance", async ({ page, context }) => {
  const password = readFileSync(PASSWORD_FILE, "utf8").trim()

  await page.goto("/login")

  // Placeholder selectors: the login inputs are not wired to <label for>, so
  // getByLabel does not resolve them.
  await page.locator('input[type="email"]').fill(EMAIL)
  await page.locator('input[type="password"]').first().fill(password)
  await page.getByRole("button", { name: /sign in|log in|continue/i }).first().click()

  // The redirect away from /login is the signal that the session took.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
  expect(page.url(), "login should leave /login").not.toContain("/login")

  await context.storageState({ path: STORAGE_STATE })
})
