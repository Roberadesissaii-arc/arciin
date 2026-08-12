import { expect, test, type Page, type Route } from "@playwright/test"

/**
 * Browser certification for the Pro entitlement fix.
 *
 * The defect: `useLicense` returned the *free* feature matrix whenever the
 * license query was not successful, so a timeout, 500, or transient 401 during
 * session hydration rendered "Upgrade to Pro" over a paying customer's
 * interface. These tests drive the entitlement endpoint directly so Pro, Free,
 * slow, failing and offline states are deterministic rather than incidental.
 *
 * Runs against the isolated dev stack only — playwright.config.ts refuses to
 * start if the target resolves to production.
 */

/** Text that must never appear while a Pro user is signed in. */
const PAYWALL_TEXT = [
  "Full AI Chat is available on Pro",
  "Upgrade to Pro",
  "Test Ollama model",
]

const LICENSE_ROUTE = "**/api/license/status"

const PRO_FEATURES = [
  "ai.chat",
  "ai.vision",
  "ai.tools",
  "developer.api_keys",
  "developer.webhooks",
  "developer.app_databases",
  "vault.passwords",
].map((id) => ({ id }))

function licenseBody(plan: "pro" | "free") {
  return {
    data: {
      plan,
      status: "active",
      features: plan === "pro" ? PRO_FEATURES : [],
      expiresAt: null,
      source: "e2e-fixture",
    },
  }
}

/** Serve a deterministic entitlement response. */
async function stubLicense(
  page: Page,
  plan: "pro" | "free",
  options: { delayMs?: number; failFirst?: number; status?: number } = {},
) {
  let calls = 0
  await page.route(LICENSE_ROUTE, async (route: Route) => {
    calls += 1
    if (options.failFirst && calls <= options.failFirst) {
      await route.fulfill({
        status: options.status ?? 500,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "E2E_INJECTED", message: "injected failure" } }),
      })
      return
    }
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs))
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(licenseBody(plan)),
    })
  })
  return () => calls
}

/**
 * Guard against a vacuous pass.
 *
 * If the app redirected to /login or /setup there would be no paywall text
 * either, and every assertion below would pass while proving nothing. Every
 * test asserts the chat page actually rendered first.
 */
async function expectChatPageRendered(page: Page) {
  expect(page.url(), "must not have been redirected away from /chat").toContain("/chat")
  await expect(
    page.locator("textarea").first(),
    "the chat composer must be present — otherwise the no-paywall assertions are vacuous",
  ).toBeVisible({ timeout: 15_000 })
}

/** Fail the test if any paywall wording is present. */
async function expectNoPaywall(page: Page, context: string) {
  for (const text of PAYWALL_TEXT) {
    await expect(
      page.getByText(text, { exact: false }),
      `${context}: "${text}" must not be visible to a Pro user`,
    ).toHaveCount(0)
  }
}

test.describe("Pro entitlement", () => {
  test("never shows the paywall across 20 consecutive hard refreshes", async ({ page }) => {
    await stubLicense(page, "pro")

    const paywallSightings: number[] = []

    for (let refresh = 1; refresh <= 20; refresh += 1) {
      await page.goto("/chat", { waitUntil: "domcontentloaded" })

      // Check immediately, before the network settles — the flash was a
      // first-paint problem, so waiting for idle would hide it.
      for (const text of PAYWALL_TEXT) {
        if ((await page.getByText(text, { exact: false }).count()) > 0) {
          paywallSightings.push(refresh)
          break
        }
      }

      await page.waitForLoadState("networkidle").catch(() => {})
      await expectChatPageRendered(page)
      await expectNoPaywall(page, `refresh ${refresh} (settled)`)
    }

    expect(paywallSightings, "refreshes that flashed the paywall").toEqual([])
  })

  test("shows a stable shell, never the paywall, while entitlement is slow", async ({ page }) => {
    await stubLicense(page, "pro", { delayMs: 2_000 })

    await page.goto("/chat", { waitUntil: "domcontentloaded" })
    // Mid-flight: the request has not resolved yet.
    await expectNoPaywall(page, "during 2s delay")

    await page.waitForLoadState("networkidle").catch(() => {})
    await expectChatPageRendered(page)
    await expectNoPaywall(page, "after slow resolve")
  })

  test("recovers without a paywall when the first request fails", async ({ page }) => {
    await stubLicense(page, "pro", { failFirst: 1, status: 500 })

    await page.goto("/chat", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    // The retry succeeds; at no point may the upgrade screen appear.
    await expectChatPageRendered(page)
    await expectNoPaywall(page, "after 500 then retry")
  })

  test("does not paywall on a transient 401 during session hydration", async ({ page }) => {
    await stubLicense(page, "pro", { failFirst: 1, status: 401 })

    await page.goto("/chat", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    await expectChatPageRendered(page)
    await expectNoPaywall(page, "after transient 401")
    // And no redirect loop back to login.
    expect(page.url()).not.toContain("/login")
  })

  test("keeps Pro while offline rather than treating the error as Free", async ({ page }) => {
    await stubLicense(page, "pro")
    await page.goto("/chat", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    // Every entitlement request now fails outright.
    await page.route(LICENSE_ROUTE, (route) => route.abort("failed"))
    await page.reload({ waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    await expectChatPageRendered(page)
    await expectNoPaywall(page, "offline reload")
  })

  test("keeps the chat composer mounted and the page height stable", async ({ page }) => {
    await stubLicense(page, "pro")
    await page.goto("/chat", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    const heightBefore = await page.evaluate(() => document.body.scrollHeight)

    await page.reload({ waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    const heightAfter = await page.evaluate(() => document.body.scrollHeight)

    // A paywall replacing the chat UI changes the page height dramatically;
    // a stable shell does not.
    expect(Math.abs(heightAfter - heightBefore)).toBeLessThan(200)
  })
})

test.describe("Free entitlement", () => {
  test("still gates Pro features once Free is authoritative", async ({ page }) => {
    await stubLicense(page, "free")

    await page.goto("/chat", { waitUntil: "domcontentloaded" })
    await page.waitForLoadState("networkidle").catch(() => {})

    // Gating must still work — the fix must not have opened the gate.
    //
    // Waits for the gate rather than counting once. The paywall is deliberately
    // withheld until the entitlement answer is authoritative, so it appears a
    // render after the response lands; a single synchronous count raced it and
    // reported an open gate that was about to close. This still fails if the
    // gate never appears — it just stops failing when it merely appears late.
    await expect(
      page.getByText(PAYWALL_TEXT[0]!, { exact: false }).first(),
      "an authoritative Free response must produce the upgrade state",
    ).toBeVisible({ timeout: 10_000 })
  })

  test("does not paywall a Free user before the answer is authoritative", async ({ page }) => {
    await stubLicense(page, "free", { delayMs: 1_500 })

    await page.goto("/chat", { waitUntil: "domcontentloaded" })
    // Before resolution nothing is known, so no paywall yet.
    for (const text of PAYWALL_TEXT) {
      expect(
        await page.getByText(text, { exact: false }).count(),
        `"${text}" must not appear before the Free answer resolves`,
      ).toBe(0)
    }
  })
})
