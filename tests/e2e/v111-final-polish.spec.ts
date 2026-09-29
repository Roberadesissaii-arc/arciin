import { readFileSync } from "node:fs"

import { expect, test, type Page } from "@playwright/test"

import { newUnauthedContext } from "./desktop-promo"

/**
 * v1.1.1 final acceptance, in a real browser.
 *
 * 1. "Install Arciin" kept coming back after X / Not now as the owner moved
 *    between pages: the prompt stays mounted across client-side navigation and
 *    only checked the dismissal when it mounted.
 * 2. The dashboard's System card sat on "Checking services…" on a healthy
 *    instance: it asked the deliberately minimal public /health for the
 *    per-service breakdown that now lives behind /health/detailed.
 *
 * Chromium does not fire `beforeinstallprompt` for a test origin, so the spec
 * fires it the way Chrome does — on the window, cancelable, carrying prompt()
 * and userChoice — and fires it again on every page to prove it stays closed.
 */

const DISMISS_KEY = "arciin.install-dismissed"
const ROLE_FILE = "/tmp/arciin-e2e-role-users.json"
const PAGES = ["/dashboard", "/files", "/images", "/activity", "/settings"] as const

async function fireInstallEvent(page: Page) {
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: string }>
    }
    event.prompt = async () => {}
    event.userChoice = Promise.resolve({ outcome: "dismissed" })
    window.dispatchEvent(event)
  })
}

function installPrompt(page: Page) {
  return page.getByRole("dialog", { name: "Install Arciin" })
}

/** Client-side navigation when the link is on screen — the path the bug took. */
async function navigate(page: Page, href: string) {
  const link = page.locator(`a[href="${href}"]`).first()
  if (await link.isVisible().catch(() => false)) {
    await link.click()
    await page.waitForURL((url) => url.pathname === href, { timeout: 30_000 })
  } else {
    await page.goto(href)
  }
  await page.waitForLoadState("domcontentloaded")
}

for (const control of ["Not now", "X"] as const) {
  test(`install prompt dismissed with ${control} stays dismissed across pages and reloads`, async ({
    page,
  }) => {
    await page.goto("/dashboard")
    await page.evaluate((key) => localStorage.removeItem(key), DISMISS_KEY)
    await page.reload()

    await fireInstallEvent(page)
    await expect(installPrompt(page)).toBeVisible()

    if (control === "X") await installPrompt(page).getByRole("button", { name: "Dismiss" }).click()
    else await installPrompt(page).getByRole("button", { name: "Not now" }).click()
    await expect(installPrompt(page)).toHaveCount(0)
    expect(await page.evaluate((key) => localStorage.getItem(key), DISMISS_KEY)).toBe("1")

    // The browser offering again in the same page must not reopen it.
    await fireInstallEvent(page)
    await expect(installPrompt(page)).toHaveCount(0)

    for (const href of PAGES.slice(1)) {
      await navigate(page, href)
      await fireInstallEvent(page)
      await expect(installPrompt(page), `reopened on ${href}`).toHaveCount(0)
    }

    await page.reload()
    await fireInstallEvent(page)
    await expect(installPrompt(page)).toHaveCount(0)
  })
}

test("the owner's System card resolves from /health/detailed", async ({ page }) => {
  const detailedRequest = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/health/detailed"),
  )
  await page.goto("/dashboard")
  const response = await detailedRequest
  expect(response.status()).toBe(200)
  const detail = (await response.json()).data as Record<string, string>
  for (const key of ["api", "database", "redis", "worker", "storage", "version"]) {
    expect(detail).toHaveProperty(key)
  }

  // Whatever the isolated stack's worker is doing, the card must resolve.
  await expect(
    page.getByText(/All services responding on this host\.|\d of 5 services online\./),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("Checking services…")).toHaveCount(0)
  for (const label of ["API", "Database", "Redis", "Worker", "Storage"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
  }
})

test("public /health stays minimal and /health/detailed needs a session", async ({
  browser,
  baseURL,
}) => {
  const context = await newUnauthedContext(browser, { baseURL })
  try {
    const publicHealth = await context.request.get("/api/health")
    expect([200, 503]).toContain(publicHealth.status())
    const body = await publicHealth.json()
    expect(Object.keys(body.data)).toEqual(["status"])

    const detailed = await context.request.get("/api/health/detailed")
    expect(detailed.status()).toBe(401)
  } finally {
    await context.close()
  }
})

test("a member gets a clean summary, not a refused breakdown", async ({ browser, baseURL }) => {
  const { member } = JSON.parse(readFileSync(ROLE_FILE, "utf8")) as {
    member: { email: string; password: string }
  }
  const context = await newUnauthedContext(browser, { baseURL })
  const page = await context.newPage()
  const detailedCalls: number[] = []
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/api/health/detailed")) {
      detailedCalls.push(response.status())
    }
  })
  try {
    await page.goto("/login")
    await page.locator('input[type="email"]').fill(member.email)
    await page.locator('input[type="password"]').first().fill(member.password)
    await page.getByRole("button", { name: /sign in|log in|continue/i }).first().click()
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
    await page.goto("/dashboard")

    await expect(
      page.getByText(/Arciin is responding on this host\.|Arciin is running with reduced service/),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText("Checking services…")).toHaveCount(0)
    expect(detailedCalls).toEqual([])

    // The API still refuses them — the card adapted, the boundary did not move.
    const direct = await page.request.get("/api/health/detailed")
    expect(direct.status()).toBe(403)
  } finally {
    await context.close()
  }
})
