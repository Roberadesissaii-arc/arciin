import { mkdirSync } from "node:fs"
import path from "node:path"

import { expect, test, type Page, type Route } from "@playwright/test"

import { suppressWindowsDesktopPromo } from "./desktop-promo"

/**
 * The top search box as a real universal search: files (with matches by
 * meaning), folders, libraries and pages in one keyboard-driven surface.
 *
 * Search answers are fixtures so every state shows up without a model or a
 * particular library; the server side is tests/integration/universal-search.
 * One test at the end runs against the real API.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const SHOTS = process.env.ARCIIN_CAPTURE_DIR
async function shot(page: Page, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

const file = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: null,
  originalFilename: title,
  mediaType: "IMAGE",
  mimeType: "image/jpeg",
  extension: "jpg",
  durationSeconds: null,
  coverImageAt: null,
  updatedAt: "2026-10-01T00:00:00.000Z",
  library: { id: "lib-images", name: "Images", slug: "images", kind: "IMAGE" },
  folder: { id: "f-family", name: "Family", slug: "family" },
  match: { kind: "literal", label: null },
  ...extra,
})

const QUICK = {
  query: "party",
  files: [file("a1", "party invite.jpg"), file("a2", "party-2025.jpg", { folder: null })],
  folders: [
    {
      id: "f1",
      name: "Party",
      slug: "party",
      path: "/party",
      isLocked: false,
      assetCount: 12,
      library: { id: "lib-images", name: "Images", slug: "images", kind: "IMAGE" },
    },
  ],
  libraries: [],
}

const HYBRID = {
  query: "party",
  files: [
    ...QUICK.files,
    file("a3", "IMG_0042.jpg", { title: "Birthday Party 2026", match: { kind: "semantic", label: "Matched by meaning" } }),
  ],
  semantic: "used",
  index: { indexed: 412, eligible: 817 },
}

async function fixtures(page: Page, opts: { quick?: unknown; hybrid?: unknown; hybridDelayMs?: number } = {}) {
  const seen: string[] = []
  await page.route("**/api/search?**", async (route: Route) => {
    seen.push(new URL(route.request().url()).searchParams.get("q") ?? "")
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: opts.quick ?? QUICK }) })
  })
  await page.route("**/api/search/files?**", async (route: Route) => {
    if (opts.hybridDelayMs) await new Promise((r) => setTimeout(r, opts.hybridDelayMs))
    await route
      .fulfill({ contentType: "application/json", body: JSON.stringify({ data: opts.hybrid ?? HYBRID }) })
      .catch(() => {})
  })
  return seen
}

async function openSearch(page: Page) {
  await suppressWindowsDesktopPromo(page)
  await page.goto("/dashboard")
  await expect(page.getByTestId("universal-search-trigger")).toBeVisible({ timeout: 60_000 })
  await page.keyboard.press("ControlOrMeta+k")
  const dialog = page.getByTestId("universal-search")
  await expect(dialog).toBeVisible()
  return dialog
}

test("Cmd/Ctrl+K opens it; an empty query suggests pages", async ({ page }) => {
  await fixtures(page)
  const dialog = await openSearch(page)
  await expect(dialog.getByRole("combobox", { name: "Search Arciin" })).toBeFocused()
  await expect(dialog.getByText("Suggested", { exact: true })).toBeVisible()
  await expect(dialog.getByRole("option", { name: /Overview/ })).toBeVisible()
  await shot(page, "search-empty")
  await page.keyboard.press("ControlOrMeta+k")
  await expect(dialog).toBeHidden()
})

test("files, meaning matches, folders and pages arrive grouped in one surface", async ({ page }) => {
  await fixtures(page)
  const dialog = await openSearch(page)
  await dialog.getByRole("combobox").fill("party")

  const files = dialog.getByRole("group", { name: "Files" })
  await expect(files.getByRole("option", { name: /party invite\.jpg, JPG · Images · Family/ })).toBeVisible()
  // The semantic hit shows its title, its library, and a label — never a score.
  const meaning = files.getByRole("option", { name: /Birthday Party 2026/ })
  await expect(meaning).toContainText("Matched by meaning")
  await expect(dialog).not.toContainText(/0\.\d{2}/)
  await expect(dialog.getByRole("group", { name: "Folders" }).getByRole("option", { name: /Party, folder in Images/ })).toBeVisible()
  await expect(dialog.getByRole("option", { name: /View all file results/ })).toBeVisible()
  await expect(dialog.getByRole("status").first()).toContainText("412 / 817 indexed")
  // Only groups with results are shown.
  await expect(dialog.getByRole("group", { name: "Libraries" })).toHaveCount(0)
  await shot(page, "search-mixed-results")
})

test("arrow keys move the highlighted row; Enter opens it at its file", async ({ page }) => {
  await fixtures(page)
  const dialog = await openSearch(page)
  const input = dialog.getByRole("combobox")
  await input.fill("party")
  const options = dialog.getByRole("option")
  await expect(options.first()).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowDown")
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true")
  await expect(input).toHaveAttribute("aria-activedescendant", (await options.nth(1).getAttribute("id"))!)
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("ArrowUp")
  // Wraps to the last row.
  await expect(options.last()).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("Enter")
  await expect(page).toHaveURL(/\/images\/family(\?asset=a1)?$/)
  await expect(dialog).toBeHidden()
})

test("navigation is instant and needs no server", async ({ page }) => {
  await fixtures(page, { quick: { query: "settings", files: [], folders: [], libraries: [] }, hybrid: { query: "settings", files: [], semantic: "disabled", index: null } })
  const dialog = await openSearch(page)
  await dialog.getByRole("combobox").fill("settings")
  const nav = dialog.getByRole("group", { name: "Navigation" })
  await expect(nav.getByRole("option", { name: /^Settings/ })).toBeVisible()
  await shot(page, "search-navigation")
  await nav.getByRole("option", { name: /^Settings/ }).click()
  await expect(page).toHaveURL(/\/settings$/)
})

test("no results, and a quiet line when meaning is unavailable", async ({ page }) => {
  await fixtures(page, {
    quick: { query: "zzqx", files: [], folders: [], libraries: [] },
    hybrid: { query: "zzqx", files: [], semantic: "unavailable", index: null },
  })
  const dialog = await openSearch(page)
  await dialog.getByRole("combobox").fill("zzqx")
  await expect(dialog.getByText("No results for “zzqx”")).toBeVisible()
  await expect(dialog.getByText("Semantic search unavailable — showing name matches")).toBeVisible()
  await shot(page, "search-no-results")
})

test("keyword results show before meaning arrives", async ({ page }) => {
  await fixtures(page, { hybridDelayMs: 2_500 })
  const dialog = await openSearch(page)
  await dialog.getByRole("combobox").fill("party")
  await expect(dialog.getByRole("option", { name: /party invite\.jpg/ })).toBeVisible({ timeout: 1_500 })
  await expect(dialog.getByText("finding matches by meaning")).toBeVisible()
  await shot(page, "search-semantic-building")
  await expect(dialog.getByRole("option", { name: /Birthday Party 2026/ })).toBeVisible({ timeout: 5_000 })
})

test("typing on cancels the request for the stale query", async ({ page }) => {
  const aborted: string[] = []
  page.on("requestfailed", (req) => {
    if (req.url().includes("/api/search/files")) aborted.push(new URL(req.url()).searchParams.get("q") ?? "")
  })
  await fixtures(page, { hybridDelayMs: 4_000 })
  const dialog = await openSearch(page)
  const input = dialog.getByRole("combobox")
  await input.fill("par")
  // Past the debounce: the request for "par" is in flight.
  await page.waitForRequest((r) => r.url().includes("/api/search/files?q=par"))
  await input.fill("party")
  await expect.poll(() => aborted).toContain("par")
})

test("Escape closes and returns focus to the search box", async ({ page }) => {
  await fixtures(page)
  await suppressWindowsDesktopPromo(page)
  await page.goto("/dashboard")
  const trigger = page.getByTestId("universal-search-trigger")
  await expect(trigger).toBeVisible({ timeout: 60_000 })
  await trigger.click()
  await expect(page.getByTestId("universal-search")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("universal-search")).toBeHidden()
  await expect(trigger).toBeFocused()
})

test("against the real API: libraries and folders come back from the server", async ({ page }) => {
  const dialog = await openSearch(page)
  await dialog.getByRole("combobox").fill("documents")
  await expect(dialog.getByRole("group", { name: "Libraries" }).getByRole("option", { name: /Documents library/ })).toBeVisible({
    timeout: 10_000,
  })
})

test("tablet portrait: inside the viewport, no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  await fixtures(page)
  const dialog = await openSearch(page)
  await dialog.getByRole("combobox").fill("party")
  await expect(dialog.getByRole("option", { name: /party invite\.jpg/ })).toBeVisible()
  const box = (await dialog.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(4)
  expect(box.x + box.width).toBeLessThanOrEqual(768 - 4)
  expect(box.y + box.height).toBeLessThanOrEqual(1024)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await shot(page, "search-tablet")
})

test("phone: the desktop-only screen, without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await suppressWindowsDesktopPromo(page)
  await page.goto("/dashboard")
  await expect(page.getByRole("heading", { name: "Built for desktop, not phones" })).toBeVisible({ timeout: 60_000 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
