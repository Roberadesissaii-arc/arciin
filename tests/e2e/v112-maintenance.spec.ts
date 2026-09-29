import { expect, test } from "@playwright/test"

/**
 * v1.1.2 maintenance, in a real browser: Clear inbox, the Folders
 * classification and the read-only storage audit.
 */

async function createNotification(page: import("@playwright/test").Page) {
  const libraries = (await (await page.request.get("/api/libraries")).json()).data as Array<{ id: string; kind: string }>
  const images = libraries.find((l) => l.kind === "IMAGE")!
  const res = await page.request.post(`/api/libraries/${images.id}/folders`, { data: { name: `E2E clear ${Date.now()}` } })
  expect(res.ok()).toBe(true)
}

test("Clear inbox empties the inbox and keeps Activity", async ({ page }) => {
  await page.goto("/notifications")
  await createNotification(page)
  const before = (await (await page.request.get("/api/notifications?limit=1")).json()).data
  expect(before.total).toBeGreaterThan(0)
  const activityBefore = ((await (await page.request.get("/api/activity")).json()).data as unknown[]).length
  await page.reload()

  await page.getByTestId("notifications-clear").click()
  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toContainText("Clear all notifications?")
  await expect(dialog).toContainText("Your Activity history will stay available.")
  await page.getByTestId("notifications-clear-confirm").click()

  await expect(page.getByText("No notifications", { exact: true })).toBeVisible()
  const after = (await (await page.request.get("/api/notifications?limit=1")).json()).data
  expect(after).toMatchObject({ total: 0, unreadCount: 0 })
  // History is still there.
  const activityAfter = ((await (await page.request.get("/api/activity")).json()).data as unknown[]).length
  expect(activityAfter).toBe(activityBefore)

  // Something new still arrives.
  await createNotification(page)
  const next = (await (await page.request.get("/api/notifications?limit=1")).json()).data
  expect(next.total).toBe(1)
})

test("Database → Folders separates current, legacy and deleted", async ({ page }) => {
  await page.goto("/database/folders")
  await expect(page.getByTestId("folder-audit-note")).toContainText("current")
  await expect(page.getByTestId("folder-audit-note")).toContainText("nothing is removed")
  // Each chip is "<count> <label>"; the four sit together under the title.
  const chips = page.getByText(/historical records/).first().locator("xpath=../..")
  for (const label of [/\d[\d,]*\s*historical records/, /\d[\d,]*\s*current/, /\d[\d,]*\s*legacy computer/, /\d[\d,]*\s*deleted/]) {
    await expect(chips).toContainText(label)
  }
  await page.getByTestId("folder-filter-current").click()
  await expect(page.getByTestId("folder-filter-current")).toHaveAttribute("aria-checked", "true")
  const current = page.locator("tbody tr")
  if ((await current.count()) > 0) {
    await expect(current.first()).toContainText("current")
  }
  await page.getByTestId("folder-filter-legacy").click()
  await expect(page.getByTestId("folder-filter-legacy")).toHaveAttribute("aria-checked", "true")
})

test("the storage audit runs read-only and offers no clean-up", async ({ page }) => {
  await page.goto("/database")
  const card = page.getByTestId("storage-audit-card")
  await expect(card).toContainText("Read-only audit")
  await card.getByTestId("storage-audit-run").click()
  const numbers = card.getByTestId("storage-audit-numbers")
  await expect(numbers).toBeVisible({ timeout: 60_000 })
  for (const label of ["Used", "Free", "Managed files", "Trash", "Backups", "Potential orphan candidates"]) {
    await expect(numbers.getByText(label, { exact: true })).toBeVisible()
  }
  await expect(card.getByRole("button", { name: /delete|clean|remove/i })).toHaveCount(0)
  // Nothing in the page names a directory on this server.
  expect(await card.innerText()).not.toMatch(/\/srv\/|\/home\/|\/tmp\//)
})
