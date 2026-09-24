import { readFileSync } from "node:fs"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { suppressWindowsDesktopPromo } from "./desktop-promo"

/**
 * v1.1.0 release behaviours, end to end in a real browser against the
 * isolated dev stack. Each test cleans up what it creates.
 */

const EMAIL = "e2e@arciin.invalid"
const password = () => readFileSync("/tmp/arciin-e2e-pw", "utf8").trim()

async function unreadCount(request: APIRequestContext) {
  const res = await request.get("/api/notifications?limit=1")
  expect(res.ok()).toBe(true)
  return (await res.json()).data.unreadCount as number
}

function badge(page: Page) {
  return page.getByLabel(/unread notifications/)
}

test("notifications are server-backed: badge, mark-all from another session, reload", async ({ page, request, browser }) => {
  await request.post("/api/notifications/mark-all-read")
  await page.goto("/dashboard")
  await expect(badge(page)).toHaveCount(0, { timeout: 30_000 })

  // Something happens: creating an API key records an activity event for us.
  const created = await request.post("/api/api-keys", { data: { name: `notify-spec-${Date.now()}`, scopes: ["assets:read"] } })
  expect(created.status()).toBe(201)
  const keyId = (await created.json()).data.apiKey.id as string

  try {
    // Realtime (socket) or the focus/interval refetch brings the badge up.
    await expect.poll(async () => unreadCount(request)).toBeGreaterThan(0)
    await page.reload()
    await expect(badge(page)).toBeVisible({ timeout: 30_000 })

    // A second, separately signed-in session marks everything read.
    // A genuinely different browser: no stored cookies. browser.newContext()
    // otherwise inherits the project's storageState — the same device cookie —
    // and signing in again on one device deliberately replaces its session.
    const other = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    await suppressWindowsDesktopPromo(other)
    try {
      const login = await other.request.post("/api/auth/login", { data: { email: EMAIL, password: password() } })
      expect(login.ok()).toBe(true)
      const otherPage = await other.newPage()
      await otherPage.goto("/notifications")
      const markAll = otherPage.getByRole("button", { name: /mark all read/i })
      await expect(markAll).toBeEnabled({ timeout: 30_000 })
      await markAll.click()
      await expect(markAll).toBeDisabled({ timeout: 15_000 })
    } finally {
      await other.close()
    }

    // The first session converges without a reload (socket notifications.read),
    // and stays converged across one.
    await expect(badge(page)).toHaveCount(0, { timeout: 30_000 })
    await page.reload()
    await expect(badge(page)).toHaveCount(0, { timeout: 30_000 })
    expect(await unreadCount(request)).toBe(0)
  } finally {
    await request.delete(`/api/api-keys/${keyId}`)
  }
})

test("no localStorage inbox is written any more", async ({ page }) => {
  await page.goto("/notifications")
  await expect(page.getByRole("heading", { name: /notifications/i }).first()).toBeVisible({ timeout: 30_000 })
  const stored = await page.evaluate(() => localStorage.getItem("arciin_notification_inbox"))
  expect(stored).toBeNull()
})

test("All Files search finds archived files and marks them; Trash stays out", async ({ page, request }) => {
  const libs = (await (await request.get("/api/libraries")).json()).data as Array<{ id: string; slug: string }>
  const docs = libs.find((l) => l.slug === "documents")!
  const name = `archived-search-${Date.now()}.txt`
  const upload = await request.post(`/api/uploads?targetLibraryId=${docs.id}`, {
    multipart: { file: { name, mimeType: "text/plain", buffer: Buffer.from("archived search probe") } },
  })
  expect(upload.status()).toBe(201)
  const assetId = (await upload.json()).data.assetId as string

  try {
    expect((await request.post(`/api/assets/${assetId}/archive`)).ok()).toBe(true)

    await page.goto("/files")
    const search = page.getByPlaceholder("Search files and metadata")
    await expect(search).toBeVisible({ timeout: 60_000 })

    // Browsing: archived files stay hidden.
    await expect(page.locator(`[data-asset-id="${assetId}"]`)).toHaveCount(0)

    // Searching: found, and marked.
    await search.fill(name)
    const card = page.locator(`[data-asset-id="${assetId}"]`)
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card.getByTestId("asset-archived-badge")).toBeVisible()

    // Trash: never in search.
    expect((await request.delete(`/api/assets/${assetId}`)).ok()).toBe(true)
    await page.reload()
    await search.fill(name)
    await expect(page.locator(`[data-asset-id="${assetId}"]`)).toHaveCount(0, { timeout: 30_000 })

    // Restore: found again (still archived).
    expect((await request.post(`/api/trash/${assetId}/restore`)).ok()).toBe(true)
    await page.reload()
    await search.fill(name)
    await expect(page.locator(`[data-asset-id="${assetId}"]`)).toBeVisible({ timeout: 30_000 })
  } finally {
    await request.delete(`/api/assets/${assetId}`)
    await request.delete(`/api/trash/${assetId}`)
  }
})

test("sidebar expand/collapse survives a reload", async ({ page, request }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  const sidebar = page.locator('[data-slot="sidebar"][data-state]').first()
  const before = (await (await request.get("/api/auth/preferences")).json()).data.appearance.sidebarCollapsed as boolean

  try {
    await page.goto("/dashboard")
    await expect(sidebar).toHaveAttribute("data-state", before ? "collapsed" : "expanded", { timeout: 30_000 })

    await page.getByTestId("sidebar-collapse-toggle").click()
    const toggled = before ? "expanded" : "collapsed"
    await expect(sidebar).toHaveAttribute("data-state", toggled)
    await expect
      .poll(async () => (await (await request.get("/api/auth/preferences")).json()).data.appearance.sidebarCollapsed)
      .toBe(!before)

    await page.reload()
    await expect(sidebar).toHaveAttribute("data-state", toggled, { timeout: 30_000 })

    // And back, by keyboard.
    await page.keyboard.press("Control+b")
    await expect(sidebar).toHaveAttribute("data-state", before ? "collapsed" : "expanded")
    await page.reload()
    await expect(sidebar).toHaveAttribute("data-state", before ? "collapsed" : "expanded", { timeout: 30_000 })
  } finally {
    await request.patch("/api/auth/preferences", { data: { appearance: { sidebarCollapsed: before } } })
  }
})

test("Plex and Jellyfin show a health state, never a bare 'Connected'", async ({ page }) => {
  await page.goto("/integrations")
  const badges = page.getByTestId("connector-health-badge")
  await expect(badges).toHaveCount(2, { timeout: 60_000 })
  for (const b of await badges.all()) {
    expect(["healthy", "degraded", "disconnected", "error"]).toContain(await b.getAttribute("data-state"))
  }
  await expect(page.getByText(/^Connected$/)).toHaveCount(0)
})

test("Database → API Keys filters by status without deleting history", async ({ page, request }) => {
  const created = await request.post("/api/api-keys", { data: { name: `filter-spec-${Date.now()}`, scopes: ["assets:read"] } })
  const keyId = (await created.json()).data.apiKey.id as string
  await request.delete(`/api/api-keys/${keyId}`) // now a revoked history row

  await page.goto("/database/api-keys")
  await expect(page.getByTestId("api-key-filter-all")).toHaveAttribute("aria-checked", "true", { timeout: 60_000 })
  const all = (await (await request.get("/api/admin/tables/api-keys?limit=50")).json()).data.total as number

  await page.getByTestId("api-key-filter-revoked").click()
  await expect(page.getByText("Revoked").first()).toBeVisible()
  await expect(page.locator("tbody tr").filter({ hasText: /\bActive\b/ })).toHaveCount(0)

  await page.getByTestId("api-key-filter-all").click()
  expect((await (await request.get("/api/admin/tables/api-keys?limit=50")).json()).data.total).toBe(all)
})

test("storage Rescan answers, and labels say which part is mounted", async ({ page }) => {
  await page.goto("/settings?tab=attached-disks")
  const rescan = page.getByTestId("storage-rescan")
  await expect(rescan).toBeVisible({ timeout: 60_000 })
  await rescan.click()
  await expect(page.getByText(/No new disks found\.|Storage devices refreshed\./).first()).toBeVisible({ timeout: 60_000 })
  // Physical disks are labelled as devices; this host has at least one.
  await expect(page.getByText("Device: Connected").first()).toBeVisible()
})
