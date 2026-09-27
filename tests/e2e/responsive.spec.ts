import { mkdirSync } from "node:fs"

import { expect, test, type Page } from "@playwright/test"

import { newUnauthedContext } from "./desktop-promo"

/**
 * Layout at four viewport sizes.
 *
 * Asserts what can be asserted — the page does not scroll sideways and its
 * main content renders — and saves a screenshot of each for review. Below the
 * md breakpoint the dashboard deliberately shows the "use the mobile app"
 * screen (the phone surface is a separate app on its own port), so at 390px
 * that screen is what is checked.
 */

const SIZES = [
  { name: "1600x900", width: 1600, height: 900, desktop: true },
  { name: "1024x768", width: 1024, height: 768, desktop: true },
  { name: "768x1024", width: 768, height: 1024, desktop: true },
  { name: "390x844", width: 390, height: 844, desktop: false },
] as const

const PAGES = [
  { path: "/dashboard", name: "dashboard" },
  { path: "/files", name: "files" },
  { path: "/notifications", name: "notifications" },
  { path: "/settings?tab=mfa", name: "settings-mfa" },
  { path: "/settings?tab=attached-disks", name: "storage-disks" },
] as const

const OUT = "test-results/responsive"
mkdirSync(OUT, { recursive: true })

async function noHorizontalScroll(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  expect(scroll, `page scrolls sideways (${scroll} > ${client})`).toBeLessThanOrEqual(client + 1)
}

for (const size of SIZES) {
  test.describe(`at ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test("login", async ({ browser, baseURL }) => {
      const context = await newUnauthedContext(browser, { baseURL })
      await context.setDefaultTimeout(30_000)
      const page = await context.newPage()
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto("/login")
      await expect(page.locator('input[type="email"]')).toBeVisible()
      await expect(page.locator('input[type="password"]')).toBeVisible()
      await noHorizontalScroll(page)
      await page.screenshot({ path: `${OUT}/${size.name}-login.png` })
      await context.close()
    })

    for (const target of PAGES) {
      test(target.name, async ({ page }) => {
        await page.goto(target.path)
        if (size.desktop) {
          await expect(page.locator('[data-slot="sidebar"]').first()).toBeAttached({ timeout: 60_000 })
          await expect(page.locator("main, .dashboard-main").first()).toBeVisible()
        } else {
          await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 60_000 })
        }
        await page.waitForLoadState("networkidle").catch(() => {})
        await noHorizontalScroll(page)
        await page.screenshot({ path: `${OUT}/${size.name}-${target.name}.png` })
      })
    }
  })
}
