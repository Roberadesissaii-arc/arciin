import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page } from "@playwright/test"

import { suppressWindowsDesktopPromo } from "./desktop-promo"

/**
 * v1.1.3 interface refinement: Database (folder classification), the storage
 * audit, Notifications, the sidebar, and layout at common viewport sizes.
 * Read-only throughout — the storage audit is run, nothing is cleaned.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const SHOTS = process.env.ARCIIN_CAPTURE_DIR
async function shot(page: Page, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })
}

test.beforeEach(async ({ page }) => {
  await suppressWindowsDesktopPromo(page as never)
})

test("Database hub: the Folders card shows current, legacy and deleted", async ({ page }) => {
  await page.goto("/database")
  const summary = page.getByTestId("database-card-folders-summary")
  await expect(summary).toBeVisible({ timeout: 60_000 })
  await expect(summary).toContainText(/\d[\d,]* current/)
  await expect(summary).toContainText(/\d[\d,]* legacy computer/)
  await expect(summary).toContainText(/\d[\d,]* deleted/)
  await shot(page, "database-hub")
})

test("Database → Folders: filters with counts, readable rows, raw values on request", async ({ page }) => {
  await page.goto("/database/folders")
  const legacy = page.getByTestId("folder-filter-legacy")
  await expect(legacy).toBeVisible({ timeout: 60_000 })
  await expect(legacy).toHaveText(/legacy\s*\d[\d,]*/i)
  await expect(page.getByRole("columnheader", { name: "Folder" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Library" })).toBeVisible()
  await expect(page.getByRole("columnheader", { name: "Classification" })).toBeVisible()
  // Ids are not primary content…
  await expect(page.getByRole("columnheader", { name: "libraryId" })).toHaveCount(0)
  await shot(page, "database-folders")
  // …but stay one click away.
  await page.getByTestId("admin-table-show-raw").check()
  await expect(page.getByRole("columnheader", { name: "libraryId" })).toBeVisible()
  await page.getByTestId("admin-table-show-raw").uncheck()

  await legacy.click()
  await expect(legacy).toHaveAttribute("aria-checked", "true")
  const rows = page.locator("tbody tr")
  if ((await rows.count()) > 0) await expect(rows.first()).toContainText("Legacy Computer")
  await shot(page, "database-folders-legacy")
})

test("Storage audit: disk bar, stat cards, where the space goes — and no clean-up", async ({ page }) => {
  await page.goto("/database")
  const card = page.getByTestId("storage-audit-card")
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.getByTestId("storage-audit-run").click()
  await expect(card.getByTestId("storage-audit-numbers")).toBeVisible({ timeout: 90_000 })
  await expect(card.getByRole("progressbar", { name: "Disk used" })).toBeVisible()
  for (const label of ["Used", "Free", "Managed files", "Backups", "Trash", "Failed uploads", "Potential orphan candidates", "Ollama models"]) {
    await expect(card.getByTestId("storage-audit-numbers").getByText(label, { exact: true })).toBeVisible()
  }
  await expect(card.getByTestId("storage-audit-breakdown")).toContainText("Where the space goes")
  await expect(card.getByRole("button", { name: /delete|clean|remove|purge/i })).toHaveCount(0)
  expect(await card.innerText()).not.toMatch(/\/srv\/|\/home\/|\/tmp\/|\/data\//)
  await card.scrollIntoViewIfNeeded()
  await shot(page, "storage-audit")
})

async function makeNotification(page: Page) {
  const libraries = (await (await page.request.get("/api/libraries")).json()).data as Array<{ id: string; kind: string }>
  const images = libraries.find((l) => l.kind === "IMAGE")!
  const res = await page.request.post(`/api/libraries/${images.id}/folders`, { data: { name: `E2E polish ${Date.now()}` } })
  expect(res.ok()).toBe(true)
}

test("Notifications: unread is marked, all-read is quiet, clearing leaves Activity", async ({ page }) => {
  await page.goto("/notifications")
  await makeNotification(page)
  await page.reload()
  const unreadRow = page.locator("tr[data-unread]").first()
  await expect(unreadRow).toBeVisible({ timeout: 60_000 })
  await expect(unreadRow).toContainText("Unread")
  await expect(page.getByTestId("notifications-summary")).toContainText(/\d+ unread/)
  await shot(page, "notifications-unread")

  await page.getByRole("button", { name: "Mark all read" }).click()
  await expect(page.locator("tr[data-unread]")).toHaveCount(0)
  await expect(page.getByTestId("notifications-summary")).toContainText("All read")
  await shot(page, "notifications-all-read")

  await page.getByTestId("notifications-clear").click()
  await page.getByTestId("notifications-clear-confirm").click()
  await expect(page.getByText("No notifications", { exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "View Activity" })).toBeVisible()
  await shot(page, "notifications-empty")
})

test("Sidebar: orange active marker, current page announced, libraries reachable when collapsed", async ({ page }) => {
  await page.goto("/images")
  const sidebar = page.locator('[data-slot="sidebar"]').first()
  const active = sidebar.getByRole("link", { name: /^Images/ })
  await expect(active).toHaveAttribute("aria-current", "page", { timeout: 60_000 })
  await shot(page, "sidebar-active")
  await page.getByTestId("sidebar-collapse-toggle").click()
  // Collapsed: each library is still a link, named for its tooltip.
  await expect(sidebar.locator('a[href="/videos"]')).toBeVisible()
  await expect(sidebar.locator('a[href="/images"]')).toHaveAttribute("aria-current", "page")
  await shot(page, "sidebar-collapsed")
  await page.getByTestId("sidebar-collapse-toggle").click()
})

for (const [w, h] of [
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [768, 1024],
] as const) {
  test(`no horizontal overflow at ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    for (const route of ["/dashboard", "/files", "/database", "/database/folders", "/notifications", "/settings"]) {
      await page.goto(route)
      await page.waitForLoadState("networkidle").catch(() => {})
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${route} at ${w}×${h}`).toBeLessThanOrEqual(0)
    }
  })
}
