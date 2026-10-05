import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type Locator, type Page } from "@playwright/test"

import { suppressWindowsDesktopPromo } from "./desktop-promo"

/**
 * v1.1.3 floating inspector: Import from link and the asset inspector share
 * one compact shell — inset from the edges, as tall as its content, header
 * and footer always reachable. Import answers are fixtures (no third-party
 * site is reached); the asset inspector runs on the seeded dev instance.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const SHOTS = process.env.ARCIIN_CAPTURE_DIR
async function shot(page: Page, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
}

const PNG = readFileSync(path.resolve(__dirname, "../fixtures/e2e-image-fixture.png"))

/**
 * One panel family: inset 16–28px from the top, right and bottom, 410–440px
 * wide, and always the full available height — never a short card with a dead
 * area underneath.
 */
async function expectFloating(page: Page, panel: Locator) {
  await expect.poll(async () => (await panel.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(16)
  const box = (await panel.boundingBox())!
  const vp = page.viewportSize()!
  const bottomInset = vp.height - (box.y + box.height)
  const rightInset = vp.width - (box.x + box.width)
  expect(box.y, "top inset").toBeLessThanOrEqual(28)
  expect(bottomInset, "bottom inset").toBeGreaterThanOrEqual(16)
  expect(bottomInset, "bottom inset — fills the height").toBeLessThanOrEqual(28)
  expect(rightInset, "right inset").toBeGreaterThanOrEqual(16)
  expect(rightInset, "right inset").toBeLessThanOrEqual(28)
  expect(box.width).toBeGreaterThanOrEqual(410)
  expect(box.width).toBeLessThanOrEqual(440)
  return box
}

const candidate = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `c${n}`,
  url: `https://www.youtube.com/watch?v=vid${n}`,
  title: [
    "Building a Data Center — Redundancy Explained",
    "Cooling at Scale: Hot Aisle / Cold Aisle",
    "Power Distribution 101",
    "Fiber Runs and Patch Panels",
    "Disaster Recovery Drills",
  ][n - 1],
  hasThumbnail: true,
  durationSeconds: 300 + n * 61,
  source: "YouTube",
  category: "video",
  ...extra,
})

async function importFixtures(page: Page, answer: Record<string, unknown>) {
  await page.route("**/api/imports/inspect", async (route) => {
    const { url } = route.request().postDataJSON() as { url: string }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { inspectionId: "insp_fixture_0123456789", url, title: null, reason: null, ...answer } }),
    })
  })
  const thumbs: string[] = []
  await page.route("**/api/imports/inspections/**/thumbnail", async (route) => {
    thumbs.push(route.request().url())
    // c3's preview is unavailable: the row must fall back to an icon.
    if (route.request().url().includes("/items/c3/")) return route.fulfill({ status: 404, body: "" })
    await route.fulfill({ contentType: "image/png", body: PNG })
  })
  return thumbs
}

async function openImport(page: Page) {
  await suppressWindowsDesktopPromo(page as never)
  await page.goto("/dashboard")
  await page.getByRole("button", { name: "Import from link" }).click()
  const panel = page.getByTestId("import-link-panel")
  await expect(panel).toBeVisible()
  return panel
}

test.describe("Import from link — compact floating panel", () => {
  test("empty: full height, inset, footer anchored at the bottom", async ({ page }) => {
    const panel = await openImport(page)
    const box = await expectFloating(page, panel)
    const footer = (await panel.getByTestId("import-link-submit").boundingBox())!
    expect(box.y + box.height - (footer.y + footer.height), "footer sits at the bottom").toBeLessThanOrEqual(24)
    await expect(panel.getByTestId("import-link-help")).toBeVisible()
    await expect(panel.getByTestId("import-link-submit")).toBeInViewport()
    await expect(panel.getByText("Download options")).toBeVisible()
    await expect(panel.getByText("Supported sources")).toBeVisible()
    await shot(page, "import-empty")
  })

  test("single result: real title and a same-origin thumbnail", async ({ page }) => {
    const thumbs = await importFixtures(page, { kind: "single", items: [candidate(1)] })
    const panel = await openImport(page)
    await panel.getByTestId("import-link-input").fill("https://www.youtube.com/watch?v=vid1")
    const item = panel.getByTestId("import-single-item")
    await expect(item).toContainText("Building a Data Center — Redundancy Explained", { timeout: 10_000 })
    await expect(item.locator("img")).toBeVisible()
    await expect.poll(() => thumbs.length).toBeGreaterThan(0)
    // Same origin, by id — never the third-party address.
    for (const url of thumbs) expect(new URL(url).pathname).toMatch(/^\/api\/imports\/inspections\/insp_fixture_0123456789\/items\/c1\/thumbnail$/)
    const srcs = await page.locator("img").evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src))
    expect(srcs.filter((s) => /ytimg|youtube\.com/.test(s))).toEqual([])
    await expectFloating(page, panel)
    await shot(page, "import-single")
  })

  test("five results, a failed thumbnail falls back to an icon, selection and audio mode", async ({ page }) => {
    await importFixtures(page, { kind: "collection", title: "Data Center Basics", items: [1, 2, 3, 4, 5].map((n) => candidate(n)) })
    const panel = await openImport(page)
    await panel.getByTestId("import-link-input").fill("https://www.youtube.com/playlist?list=PLx")
    const list = panel.getByTestId("import-candidates")
    await expect(list.getByRole("listitem")).toHaveCount(5, { timeout: 10_000 })
    const thumbsBox = list.getByTestId("import-candidate-thumb")
    await expect(thumbsBox.nth(0).locator("img")).toBeVisible()
    // c3: 404 → icon, never a broken image.
    await expect(thumbsBox.nth(2).locator("img")).toHaveCount(0)
    await expect(thumbsBox.nth(2).locator("svg")).toBeVisible()
    const firstThumb = (await thumbsBox.nth(0).boundingBox())!
    expect(firstThumb.width).toBeGreaterThanOrEqual(64)
    expect(firstThumb.width).toBeLessThanOrEqual(76)
    expect(Math.abs(firstThumb.width / firstThumb.height - 16 / 9)).toBeLessThan(0.1)
    await expectFloating(page, panel)
    await expect(panel.getByTestId("import-link-submit")).toBeInViewport()
    // Nothing is squeezed: the cards keep their full height and the body scrolls.
    for (const el of [list, panel.getByRole("group", { name: "Download format" })]) {
      const clipped = await el.evaluate((node) => node.scrollHeight - node.clientHeight)
      expect(clipped).toBeLessThanOrEqual(1)
    }
    await list.getByRole("listitem").last().scrollIntoViewIfNeeded()
    await expect(list.getByRole("listitem").last()).toBeInViewport()
    await list.getByRole("listitem").first().scrollIntoViewIfNeeded()
    await shot(page, "import-five")

    await list.getByRole("button", { name: "Select all" }).click()
    await expect(panel.getByTestId("import-candidates-count")).toHaveText("5 selected")
    await expect(panel.getByTestId("import-link-submit")).toHaveText("Import 5 items")
    await shot(page, "import-selected")

    await panel.getByLabel("Audio only").check()
    await panel.getByRole("button", { name: /MP3 audio/ }).click()
    await expect(panel.getByRole("button", { name: /MP3 audio/ })).toHaveAttribute("aria-pressed", "true")
    await shot(page, "import-audio-mode")

    // The four format cards are one height.
    const heights = await panel.getByRole("group", { name: "Download format" }).getByRole("button").evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().height)),
    )
    expect(new Set(heights).size).toBe(1)
  })
})

const panel = (page: Page) => page.getByTestId("asset-side-panel")

async function openAsset(page: Page, route: string, assetId: string) {
  await suppressWindowsDesktopPromo(page as never)
  await page.goto(route)
  const card = page.locator(`[data-asset-id="${assetId}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click()
  await expect(panel(page)).toBeVisible({ timeout: 15_000 })
  return card
}

async function openSection(page: Page, card: Locator, section: "edit" | "rename" | "ai" | "move" | "share") {
  // The full-height panel covers the grid's right-hand column, where the
  // fixture card sits: close it first, as a person would, then use the menu.
  if ((await panel(page).count()) > 0) {
    await page.keyboard.press("Escape")
    await expect(panel(page)).toHaveCount(0)
  }
  await card.click({ button: "right" })
  await page.getByTestId(`asset-menu-${section}`).click()
  await expect(panel(page)).toBeVisible({ timeout: 15_000 })
}

test.describe("Asset inspector — floating shell", () => {
  test("image: preview, name, type/library chips, details; compact and inset", async ({ page }) => {
    await openAsset(page, "/images", "e2e-image-fixture")
    await expect(panel(page).getByTestId("asset-panel-preview").locator("img")).toBeVisible()
    await expect(panel(page).getByTestId("asset-panel-context")).toContainText("Images")
    await expect(panel(page)).toContainText("480×270")
    await expectFloating(page, panel(page))
    await expect(panel(page).getByTestId("asset-panel-download")).toBeInViewport()
    await shot(page, "inspector-overview")
  })

  test("video: player with a poster, length in details", async ({ page }) => {
    await openAsset(page, "/videos", "e2e-video-transcript-fixture")
    await expect(panel(page).locator("video").first()).toHaveAttribute("poster", /\/api\/assets\/e2e-video-transcript-fixture\/thumbnail/)
    await expect(panel(page)).toContainText("Length")
    await expectFloating(page, panel(page))
    await shot(page, "inspector-video")
  })

  test("PDF: document preview, Assist in the same shell with the same back control", async ({ page }) => {
    const card = await openAsset(page, "/documents", "e2e-doc-fixture")
    await expect(panel(page).getByTestId("asset-panel-preview")).toBeVisible()
    await expectFloating(page, panel(page))
    await shot(page, "inspector-pdf")

    await openSection(page, card, "ai")
    await expect(panel(page).getByTestId("asset-panel-back-overview")).toBeVisible()
    await expect(panel(page).getByTestId("asset-panel-section-bar")).toContainText("Assist")
    await expectFloating(page, panel(page))
    await shot(page, "inspector-assist")
  })

  test("Edit, Move and Share: one header, one close, back to Overview, footer reachable", async ({ page }) => {
    const card = await openAsset(page, "/images", "e2e-image-fixture")
    for (const [section, heading, shotName] of [
      ["edit", "Edit", "inspector-edit"],
      ["move", "Move", "inspector-move"],
      ["share", "Share", "inspector-share"],
    ] as const) {
      await openSection(page, card, section)
      await expect(panel(page).getByTestId("asset-panel-section-bar")).toContainText(heading)
      await expect(panel(page).getByRole("button", { name: "Close" }), `${section}: one close button`).toHaveCount(1)
      await expect(panel(page).getByTestId("asset-panel-back-overview")).toBeVisible()
      await expectFloating(page, panel(page))
      await shot(page, shotName)
      await page.getByTestId("asset-panel-back-overview").click()
      await expect(panel(page).getByTestId("asset-panel-download")).toBeVisible()
    }
  })

  test("audio: artwork and play control, no fake artwork", async ({ page }) => {
    const audio = {
      id: "e2e-audio-mock",
      libraryId: "lib",
      folderId: null,
      storageObjectId: "so",
      ownerId: "u",
      filename: "x.mp3",
      originalFilename: "Morning Briefing.mp3",
      title: null,
      description: null,
      mimeType: "audio/mpeg",
      mediaType: "AUDIO",
      extension: "mp3",
      sizeBytes: 3_456_789,
      checksumSha256: "0".repeat(64),
      durationSeconds: 214,
      width: null,
      height: null,
      codec: null,
      pageCount: null,
      documentAuthor: null,
      documentSubject: null,
      documentInsight: null,
      status: "READY",
      processingError: null,
      importSourceUrl: null,
      uploadClient: null,
      badgeLabel: null,
      badgeColor: null,
      coverImageAt: null,
      showBadge: false,
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z",
      deletedAt: null,
      archivedAt: null,
    }
    await page.route("**/api/assets/page?**", (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: { items: [audio], nextCursor: null, hasMore: false, total: 1 } }) }),
    )
    await openAsset(page, "/music", "e2e-audio-mock")
    await expect(panel(page).getByTestId("asset-panel-audio-play")).toBeVisible()
    await expect(panel(page)).toContainText("3:34")
    await expectFloating(page, panel(page))
    await shot(page, "inspector-audio")
  })

  test("Escape closes; another card swaps the panel", async ({ page }) => {
    await openAsset(page, "/images", "e2e-image-fixture")
    await page.keyboard.press("Escape")
    await expect(panel(page)).toHaveCount(0)
  })
})

test("Import, Overview and Share share one geometry", async ({ page }) => {
  const importPanel = await openImport(page)
  const a = await expectFloating(page, importPanel)
  await page.keyboard.press("Escape")
  const card = await openAsset(page, "/images", "e2e-image-fixture")
  const b = await expectFloating(page, panel(page))
  await openSection(page, card, "share")
  const c = await expectFloating(page, panel(page))
  for (const box of [b, c]) {
    expect(Math.abs(box.y - a.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(box.height - a.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(box.width - a.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(box.x - a.x)).toBeLessThanOrEqual(1)
  }
})

for (const [w, h] of [
  [1280, 800],
  [1024, 768],
] as const) {
  test(`import panel at ${w}×${h}: full height, footer reachable, no horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h })
    const p = await openImport(page)
    await expectFloating(page, p)
    await expect(p.getByTestId("import-link-submit")).toBeInViewport()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await shot(page, `import-${w}x${h}`)
  })
}

test("phone 390×844: the desktop-only screen, no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await suppressWindowsDesktopPromo(page as never)
  await page.goto("/dashboard")
  await expect(page.getByRole("heading", { name: "Built for desktop, not phones" })).toBeVisible({ timeout: 60_000 })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test("tablet portrait: inspectors stay on screen", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 })
  const importPanel = await openImport(page)
  await expect.poll(async () => (await importPanel.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(16)
  const box = (await importPanel.boundingBox())!
  expect(box.x + box.width).toBeLessThanOrEqual(768 - 16)
  expect(box.x).toBeGreaterThanOrEqual(16)
  await expect(importPanel.getByTestId("import-link-submit")).toBeInViewport()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
