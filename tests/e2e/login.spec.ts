import { readFileSync } from "node:fs"

import { expect, test } from "@playwright/test"

import { suppressWindowsDesktopPromo } from "./desktop-promo"

/**
 * Signing in, end to end, in a browser that starts signed out.
 *
 * auth.setup already logs in once to produce the shared session, but it does it
 * as a fixture: when it broke, the whole suite reported "1 failed" on a setup
 * step and said nothing about which half of the flow had gone wrong. This
 * asserts the halves separately — the credential is accepted, the session is
 * actually committed to the browser's cookie jar, the browser is genuinely
 * authenticated afterwards, and the reader ends up somewhere other than the
 * login page.
 *
 * The failure this is written against looked like a broken login and was not
 * one: authentication succeeded, the cookie was stored, and the client's
 * navigation was still waiting on a first-time route compile when the
 * assertion gave up.
 */

const EMAIL = "e2e@arciin.invalid"
const PASSWORD_FILE = "/tmp/arciin-e2e-pw"

test("signing in stores a session and leaves the login page", async ({ browser, baseURL }) => {
  test.setTimeout(180_000)

  // A context of its own: the project injects a saved session, which would
  // mean never testing the login at all.
  const context = await browser.newContext({ storageState: undefined, baseURL })
  await suppressWindowsDesktopPromo(context)
  const page = await context.newPage()

  try {
    const password = readFileSync(PASSWORD_FILE, "utf8").trim()

    await page.goto("/login")
    await page.locator('input[type="email"]').fill(EMAIL)
    await page.locator('input[type="password"]').first().fill(password)

    const loginResponse = page.waitForResponse(
      (r) => r.url().includes("/api/auth/login") && r.request().method() === "POST",
      { timeout: 60_000 },
    )
    await page.getByRole("button", { name: /sign in|log in|continue/i }).first().click()

    // 1. The credential is accepted.
    const response = await loginResponse
    expect(response.status(), "valid credentials must be accepted").toBe(200)

    // 2. The session is committed to the cookie jar — not merely sent.
    const session = (await context.cookies()).find((c) => c.name === "arciin_session")
    expect(session, "a session cookie must be stored").toBeDefined()
    expect(session!.httpOnly, "the session cookie must be httpOnly").toBe(true)
    expect(session!.sameSite, "the session cookie must be SameSite=Lax").toBe("Lax")

    // 3. The browser is genuinely authenticated with it.
    const authed = await page.evaluate(async () => {
      const r = await fetch("/api/auth/preferences", { credentials: "include" })
      return r.status
    })
    expect(authed, "the stored session must authenticate a real request").toBe(200)

    // 4. And the reader is taken off the login page.
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 })
    expect(page.url()).not.toContain("/login")
  } finally {
    await context.close()
  }
})
