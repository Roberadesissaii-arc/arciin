import { expect, test, type Page } from "@playwright/test"

import { suppressWindowsDesktopPromo } from "./desktop-promo"

/**
 * Settings → Domain tells the truth about the plan.
 *
 * On a Free instance the page showed a trycloudflare address under "Public
 * addresses", a LIVE quick tunnel, and a Generate URL button that answered
 * "requires a higher Arciin plan" only after it was clicked. Without the plan
 * the page now keeps its LAN addresses and shows one locked card instead of any
 * public control.
 *
 * The server's answer is what the page reads, so these take the real response
 * and set only `publicRemoteAccess` — the enforcement itself is covered against
 * Postgres in tests/integration/remote-access-entitlement.test.ts.
 */

const LOCKED = { entitled: false, plan: "free", status: "none", requiredPlans: ["pro", "team", "business"] }
const OPEN = { entitled: true, plan: "pro", status: "active", requiredPlans: ["pro", "team", "business"] }

async function planIs(page: Page, entitlement: typeof LOCKED) {
  await page.route("**/api/settings/remote-access", async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    const res = await route.fetch()
    const body = await res.json()
    body.data.publicRemoteAccess = entitlement
    if (!entitlement.entitled) {
      // What a lapsed plan leaves behind before the server reconciles it.
      body.data.publicUrl = "https://stale-address.trycloudflare.com"
      body.data.mobilePublicUrl = "https://stale-address.trycloudflare.com"
    }
    await route.fulfill({ response: res, json: body })
  })
}

test.beforeEach(async ({ page }) => {
  await suppressWindowsDesktopPromo(page)
})

test("Free: LAN addresses stay, every public control is replaced by one locked card", async ({ page }) => {
  await planIs(page, LOCKED)
  let tunnelPolled = false
  page.on("request", (req) => {
    if (req.url().includes("/api/settings/cloudflare-tunnel")) tunnelPolled = true
  })
  await page.goto("/settings?tab=domain")

  const locked = page.getByTestId("public-remote-access-locked")
  await expect(locked).toBeVisible({ timeout: 30_000 })
  await expect(locked).toContainText("Public Remote Access")
  await expect(locked).toContainText("Available with Pro, Team, or Business")
  await expect(locked.getByRole("link", { name: "View plans" })).toHaveAttribute("href", "/settings?tab=license")

  await expect(page.getByText("LAN addresses for devices on your network")).toBeVisible()
  await expect(page.getByText("This machine").first()).toBeVisible()

  for (const gone of ["Generate URL", "Start tunnel when Arciin starts", "Public addresses", "Quick tunnel"]) {
    await expect(page.getByText(gone, { exact: true }), gone).toHaveCount(0)
  }
  await expect(page.getByText("stale-address.trycloudflare.com")).toHaveCount(0)
  await expect(page.getByText("Live", { exact: true })).toHaveCount(0)
  expect(tunnelPolled, "no tunnel status polling without the plan").toBe(false)
})

test("a paid plan shows the tunnel controls", async ({ page }) => {
  await planIs(page, OPEN)
  await page.goto("/settings?tab=domain")
  await expect(page.getByRole("button", { name: "Generate URL" })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("Quick tunnel", { exact: true })).toBeVisible()
  await expect(page.getByTestId("public-remote-access-locked")).toHaveCount(0)
})

test("a downgrade relocks the page on the next read, with no stale LIVE badge", async ({ page }) => {
  await planIs(page, OPEN)
  await page.goto("/settings?tab=domain")
  await expect(page.getByRole("button", { name: "Generate URL" })).toBeVisible({ timeout: 30_000 })

  await page.unroute("**/api/settings/remote-access")
  await planIs(page, LOCKED)
  await page.reload()
  await expect(page.getByTestId("public-remote-access-locked")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: "Generate URL" })).toHaveCount(0)
  await expect(page.getByText("Live", { exact: true })).toHaveCount(0)
})

test("WebSockets: the Cloudflare tunnel toggle is locked without the plan", async ({ page }) => {
  await planIs(page, LOCKED)
  await page.goto("/developer/web-sockets")
  const toggle = page.getByRole("button", { name: /Cloudflare Tunnel mode/ })
  await expect(toggle).toBeVisible({ timeout: 30_000 })
  await expect(toggle).toBeDisabled()
  await expect(toggle).toContainText("available with Pro, Team, or Business")
})

test("the server refuses a direct start on this instance's own plan, with a JSON code", async ({ request }) => {
  const settings = (await (await request.get("/api/settings/remote-access")).json()).data
  test.skip(settings.publicRemoteAccess?.entitled !== false, "the dev instance holds a paid plan")
  const res = await request.post("/api/settings/cloudflare-tunnel/start")
  expect(res.status()).toBe(403)
  expect((await res.json()).error.code).toBe("LICENSE_REQUIRED")
})
