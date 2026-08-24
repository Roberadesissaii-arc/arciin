import { expect, test, type Page } from "@playwright/test"

/**
 * One selected file, one workspace.
 *
 * Selecting a single file used to raise a bottom toolbar whose buttons each
 * opened a different floating dialog. This asserts the replacement: a panel
 * that floats like Edit File, keeps its shell while you move between sections,
 * and never appears when a bulk action is what you actually meant.
 *
 * The geometry assertions are the point of the redesign, so they are measured
 * against the viewport rather than trusted from a class name.
 */

const VIDEO_FIXTURE = "e2e-video-transcript-fixture"
const IMAGE_FIXTURE = "e2e-image-fixture"

const panel = (page: Page) => page.getByTestId("asset-side-panel")
const bulkBar = (page: Page) => page.getByRole("region", { name: "Bulk asset actions" })

async function openVideos(page: Page) {
  await page.goto("/videos")
  await expect(page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`)).toBeVisible({ timeout: 60_000 })
}

/** Every asset card currently rendered, in DOM order. */
function cards(page: Page) {
  return page.locator("[data-asset-selectable][data-asset-id]")
}

/**
 * Sections live on the card's right-click menu now — not a tab bar on the panel.
 * Open the menu and pick a section for the given asset card.
 */
async function openSectionFromMenu(
  page: Page,
  assetLocator: ReturnType<Page["locator"]>,
  section: "overview" | "edit" | "ai" | "move" | "share",
) {
  await assetLocator.click({ button: "right" })
  await page.getByTestId(`asset-menu-${section}`).click()
  await expect(panel(page)).toBeVisible({ timeout: 15_000 })
}

/** Assert which actions the card context menu offers. */
async function expectMenuSections(
  page: Page,
  assetLocator: ReturnType<Page["locator"]>,
  sections: Array<"overview" | "edit" | "ai" | "move" | "share">,
  absent: Array<"overview" | "edit" | "ai" | "move" | "share"> = [],
) {
  await assetLocator.click({ button: "right" })
  const menu = page.getByTestId("asset-card-menu")
  await expect(menu).toBeVisible()
  for (const section of sections) {
    await expect(menu.getByTestId(`asset-menu-${section}`)).toBeVisible()
  }
  for (const section of absent) {
    await expect(menu.getByTestId(`asset-menu-${section}`)).toHaveCount(0)
  }
  // Dismiss the menu without Escape — Escape also clears the selection and
  // closes the side panel, which would wreck the next assertion.
  await page.mouse.click(8, 8)
  await expect(menu).toHaveCount(0)
}

test.describe("the single-asset panel", () => {
  test.setTimeout(180_000)

  test("opens on single click, floats inset, and shows the file", async ({ page }) => {
    await openVideos(page)
    await expect(panel(page), "nothing selected yet").toHaveCount(0)

    await page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`).click()
    await expect(panel(page)).toBeVisible({ timeout: 15_000 })

    // 3 — the single-selection bottom toolbar is gone.
    await expect(bulkBar(page), "one file must not raise the bulk bar").toHaveCount(0)

    /**
     * Measured once it has arrived, not on the way in.
     *
     * The panel slides in from the right, and `toBeVisible()` resolves at the
     * *start* of that — so a geometry check taken immediately measures an
     * element still a few pixels off-screen and reads its inset as negative.
     * Waiting on the element's own animations is the product's actual "settled"
     * signal; a fixed delay would be both slower and a guess.
     */
    await panel(page).evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))),
    )

    // 5-8 — it floats: a gap on all of top, bottom and right, and rounded corners.
    const box = (await panel(page).boundingBox())!
    const viewport = page.viewportSize()!
    expect(box.y, "gap above").toBeGreaterThan(0)
    expect(viewport.height - (box.y + box.height), "gap below").toBeGreaterThan(0)
    expect(viewport.width - (box.x + box.width), "gap on the right").toBeGreaterThan(0)

    const radii = await panel(page).evaluate((el) => {
      const s = getComputedStyle(el)
      return [
        s.borderTopLeftRadius,
        s.borderTopRightRadius,
        s.borderBottomRightRadius,
        s.borderBottomLeftRadius,
      ].map((v) => Number.parseFloat(v))
    })
    for (const r of radii) expect(r, "all four corners rounded").toBeGreaterThan(4)

    // 9 — the file itself.
    await expect(panel(page)).toContainText(`${VIDEO_FIXTURE}.mp4`)
    await expect(panel(page).getByTestId("asset-panel-preview")).toBeVisible()
    await expect(panel(page)).toContainText("Details")
  })

  test("carries the same shell as the Edit File family", async ({ page }) => {
    await openVideos(page)
    const card = page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`)

    await openSectionFromMenu(page, card, "move")
    const mine = await panel(page).evaluate((el) => {
      const s = getComputedStyle(el)
      return { radius: s.borderTopLeftRadius, border: s.borderTopWidth, shadow: s.boxShadow !== "none" }
    })

    await expect(panel(page)).toContainText(/move/i)

    expect(mine.shadow, "a shadow, like the other library panels").toBe(true)
    expect(Number.parseFloat(mine.border), "a visible border").toBeGreaterThan(0)
    expect(Number.parseFloat(mine.radius), "medium radius").toBeGreaterThanOrEqual(8)
  })

  test("keeps one shell while moving between sections via the card menu", async ({ page }) => {
    await openVideos(page)
    const card = page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`)

    // Click opens Overview — no tab bar on the panel.
    await card.click()
    await expect(panel(page)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId("asset-panel-nav")).toHaveCount(0)
    await expect(page.getByTestId("asset-panel-download")).toBeVisible()

    // A video's menu offers Overview / AI / Rename / Move / Share (no duplicate Edit).
    await expectMenuSections(page, card, ["overview", "ai", "move", "share"], ["edit"])
    await card.click({ button: "right" })
    await expect(page.getByTestId("asset-menu-rename")).toBeVisible()
    await page.keyboard.press("Escape")

    // AI opens the video workspace (same Details as Overview + transcript tools).
    await card.click({ button: "right" })
    await page.getByTestId("asset-menu-ai").click()
    await expect(page.getByTestId("video-edit-drawer")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId("video-edit-drawer").getByRole("heading", { name: "Details" })).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("video-edit-drawer")).toHaveCount(0)

    // Rename shows the side-panel form.
    await card.click({ button: "right" })
    await page.getByTestId("asset-menu-rename").click()
    await expect(panel(page)).toContainText(/file name/i)
    await expect(panel(page).getByRole("button", { name: /save changes/i })).toBeVisible()

    // Move shows destination pickers.
    await openSectionFromMenu(page, card, "move")
    await expect(panel(page)).toContainText(/library/i)

    // Share shows the link form.
    await openSectionFromMenu(page, card, "share")
    await expect(panel(page).getByRole("button", { name: /create share link/i })).toBeVisible()

    // Back to Overview from the section chrome.
    await page.getByTestId("asset-panel-back-overview").click()
    await expect(page.getByTestId("asset-panel-download")).toBeVisible()

    // The shell never went away while all that happened.
    await expect(panel(page)).toHaveCount(1)
  })

  test("switches to another file without closing", async ({ page }) => {
    await openVideos(page)
    const all = cards(page)
    const count = await all.count()
    test.skip(count < 2, "needs at least two assets in the library")

    const first = (await all.nth(0).getAttribute("data-asset-id"))!
    const second = (await all.nth(1).getAttribute("data-asset-id"))!

    await all.nth(0).click({ button: "right" })
    await page.getByTestId("asset-menu-rename").click()
    await expect(panel(page).getByRole("button", { name: /save changes/i })).toBeVisible()

    await all.nth(1).click()
    // Same shell, new file, and back to Overview rather than the previous
    // file's half-filled Rename form.
    await expect(panel(page)).toHaveCount(1)
    await expect(panel(page).getByTestId("asset-panel-preview")).toBeVisible({ timeout: 15_000 })
    expect(first).not.toBe(second)
  })

  test("closes on Escape and on the close button, clearing the selection", async ({ page }) => {
    await openVideos(page)
    const card = page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`)

    await card.click()
    await expect(panel(page)).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press("Escape")
    await expect(panel(page)).toHaveCount(0)

    await card.click()
    await expect(panel(page)).toBeVisible({ timeout: 15_000 })
    await panel(page).getByRole("button", { name: "Close" }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(bulkBar(page), "selection cleared, so no bulk bar either").toHaveCount(0)
  })

  test("hands over to the bulk bar at two or more", async ({ page }) => {
    await openVideos(page)
    const all = cards(page)
    test.skip((await all.count()) < 2, "needs at least two assets in the library")

    await all.nth(0).click()
    await expect(panel(page)).toBeVisible({ timeout: 15_000 })

    await all.nth(1).click({ modifiers: ["ControlOrMeta"] })
    // One workspace for one file; a toolbar for a batch. Never both.
    await expect(panel(page), "single-file panel steps aside").toHaveCount(0)
    await expect(bulkBar(page)).toBeVisible({ timeout: 10_000 })
    await expect(bulkBar(page)).toContainText("2 selected")
    for (const label of ["Download", "Move", "Share", "Delete"]) {
      await expect(bulkBar(page).getByRole("button", { name: label })).toBeVisible()
    }
    await expect(bulkBar(page).getByRole("button", { name: "Edit" })).toHaveCount(0)
  })
})

test.describe("the panel does not steal the old interactions", () => {
  test.setTimeout(180_000)

  test("double click still opens the file itself", async ({ page }) => {
    await openVideos(page)
    const card = page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`)

    // The distinction that matters: one click inspects, two opens.
    await card.dblclick()
    await expect(
      page.getByLabel("File preview"),
      "double click opens the real preview, not the panel",
    ).toBeVisible({ timeout: 20_000 })
    // And it is the file itself, with the viewer's own controls.
    await expect(page.getByLabel("File preview").locator("video")).toBeVisible()
  })

  test("a table row behaves like a card", async ({ page }) => {
    await openVideos(page)

    // Wait for the toolbar rather than probing it: an unwaited isVisible()
    // raced the page and quietly skipped this test, which is worse than failing.
    const list = page.getByRole("button", { name: "List", exact: true }).first()
    await expect(list).toBeVisible({ timeout: 30_000 })
    await list.click()

    const row = page.locator(`tr[data-asset-id="${VIDEO_FIXTURE}"]`)
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.click()

    // The same panel a card opens, from a row.
    await expect(panel(page), "rows open the same panel").toBeVisible({ timeout: 15_000 })
    await expect(panel(page)).toContainText(`${VIDEO_FIXTURE}.mp4`)
    await expect(bulkBar(page)).toHaveCount(0)
    // Rows may not share the card context menu; overview is enough here.
    await expect(panel(page).getByTestId("asset-panel-preview")).toBeVisible()
  })

  test("a rename made in the panel persists", async ({ page }) => {
    await openVideos(page)
    const card = page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`)
    await card.click({ button: "right" })
    await page.getByTestId("asset-menu-rename").click()

    const field = panel(page).locator("input").first()
    await expect(field).toBeVisible()
    const original = await field.inputValue()
    const renamed = `${original.replace(/\.mp4$/, "")}-renamed.mp4`

    await field.fill(renamed)
    await panel(page).getByRole("button", { name: /save changes/i }).click()

    // Reopen from scratch and read it back.
    await page.keyboard.press("Escape")
    await page.reload()
    await expect(page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`)).toBeVisible({ timeout: 60_000 })
    await page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`).click()
    await expect(panel(page)).toContainText(renamed, { timeout: 15_000 })

    // Put it back, so the fixture stays what every other spec expects.
    await page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`).click({ button: "right" })
    await page.getByTestId("asset-menu-rename").click()
    const again = panel(page).locator("input").first()
    await again.fill(original)
    await panel(page).getByRole("button", { name: /save changes/i }).click()
    await page.reload()
    await page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`).click()
    await expect(panel(page)).toContainText(original, { timeout: 15_000 })
  })

  test("delete asks first", async ({ page }) => {
    await openVideos(page)
    await page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`).click()
    await expect(panel(page)).toBeVisible({ timeout: 15_000 })

    await page.getByTestId("asset-panel-delete").click()
    const confirm = page.getByRole("alertdialog")
    await expect(confirm, "destructive actions still confirm").toBeVisible({ timeout: 10_000 })
    await expect(confirm).toContainText(/delete this file/i)
    // Back out — nothing is deleted by this test.
    await confirm.getByRole("button", { name: /cancel/i }).click()
    await expect(confirm).toHaveCount(0)
    await expect(page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`)).toBeVisible()
  })

  test("captures the panel for visual comparison", async ({ page }, testInfo) => {
    await openVideos(page)
    await page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`).click()
    await expect(panel(page)).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(500)

    const shot = testInfo.outputPath("asset-panel-overview.png")
    await page.screenshot({ path: shot })
    await testInfo.attach("asset-panel-overview", { path: shot, contentType: "image/png" })
    console.log(`[panel] screenshot: ${shot}`)
  })
})

test.describe("asset type decides the sections", () => {
  test.setTimeout(180_000)

  test("an image gets a preview, the shared sections, and no transcript", async ({ page }, testInfo) => {
    await page.goto("/images")
    const card = page.locator('[data-asset-id="e2e-image-fixture"]')
    await expect(card).toBeVisible({ timeout: 60_000 })

    await card.click()
    await expect(panel(page)).toBeVisible({ timeout: 15_000 })
    await expect(panel(page)).toContainText("e2e-image-fixture.png")

    // Its own bytes, not a video player.
    await expect(panel(page).getByTestId("asset-panel-preview").locator("img")).toBeVisible()
    await expect(panel(page).locator("video"), "no player for a still").toHaveCount(0)

    // Image-appropriate details.
    await expect(panel(page)).toContainText("image/png")
    await expect(panel(page)).toContainText("480×270")
    await expect(panel(page), "no duration for a still").not.toContainText("Duration")

    // Menu offers shared actions; AI is video-only.
    await expectMenuSections(
      page,
      card,
      ["overview", "edit", "move", "share"],
      ["ai"],
    )
    await expect(panel(page).getByTestId("video-transcript")).toHaveCount(0)

    // Download and Delete are both offered on Overview.
    await expect(page.getByTestId("asset-panel-download")).toBeVisible()
    await expect(page.getByTestId("asset-panel-delete")).toBeVisible()

    const shot = testInfo.outputPath("asset-panel-image.png")
    await page.screenshot({ path: shot })
    await testInfo.attach("asset-panel-image", { path: shot, contentType: "image/png" })
    console.log(`[panel] image screenshot: ${shot}`)
  })

  test("a video offers AI; other types do not", async ({ page }) => {
    await openVideos(page)
    const videoCard = page.locator(`[data-asset-id="${VIDEO_FIXTURE}"]`)
    await expectMenuSections(page, videoCard, ["overview", "ai", "move", "share"], ["edit"])
    await videoCard.click({ button: "right" })
    await expect(page.getByTestId("asset-menu-rename")).toBeVisible()
    await page.mouse.click(8, 8)

    /**
     * A PDF is offered Assist; it has text to work on.
     *
     * The documents library leads with PDFs, and this used to assert that no
     * document was offered AI at all. That stopped being true when PDF Assist
     * shipped — the menu offers AI and Rename there, exactly as it does for a
     * video — so asserting its absence was testing the old product.
     */
    await page.goto("/documents")
    const docs = cards(page)
    await expect(docs.first(), "documents library should have files").toBeVisible({
      timeout: 60_000,
    })
    await docs.nth(0).click()
    await expect(panel(page)).toBeVisible({ timeout: 15_000 })
    // A PDF has no transcript — Assist reads the document itself.
    await expect(panel(page).getByTestId("video-transcript")).toHaveCount(0)
    await expectMenuSections(page, docs.nth(0), ["overview", "ai", "move", "share"], ["edit"])

    /**
     * An image cannot be offered either, and that is the half of the original
     * claim that still holds. The seeded image fixture keeps it deterministic
     * rather than depending on whatever the library happens to list first.
     */
    await page.goto("/images")
    const image = page.locator(`[data-asset-id="${IMAGE_FIXTURE}"]`)
    await expect(image).toBeVisible({ timeout: 60_000 })
    await image.click()
    await expect(panel(page)).toBeVisible({ timeout: 15_000 })
    await expect(panel(page).getByTestId("video-transcript")).toHaveCount(0)
    await expectMenuSections(page, image, ["overview", "edit", "move", "share"], ["ai"])
  })
})
