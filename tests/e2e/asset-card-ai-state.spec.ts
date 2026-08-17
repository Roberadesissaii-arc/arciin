import { expect, test, type Page } from "@playwright/test"

/**
 * What a card knows about AI work when the panel is closed.
 *
 * The requirement behind this suite is a sequence, not a screenshot: start a
 * dub, close the panel, walk away, come back, reload, and the card still knows.
 * That can only be true if the state is the server's, so every test here either
 * navigates or reloads before asserting — a component holding the answer in
 * memory would pass a static check and fail all of these.
 *
 * The other requirement is that knowing costs nothing per card. A grid of two
 * hundred videos must not become two hundred status requests, so the request
 * count is asserted directly rather than assumed from how the code reads.
 */

const FIXTURE = "e2e-video-transcript-fixture"
/** The seeded dub left mid-separation at 39 of 122. */
const RUNNING = "ar"

const card = (page: Page, assetId = FIXTURE) => page.locator(`[data-asset-id="${assetId}"]`)
const indicator = (page: Page) => card(page).getByTestId("asset-ai-indicator")

async function openVideos(page: Page) {
  await page.goto("/videos")
  await expect(card(page)).toBeVisible({ timeout: 60_000 })
}

test.describe("card AI indicator", () => {
  test.setTimeout(180_000)

  test("shows running work on the thumbnail without opening anything", async ({ page }) => {
    await openVideos(page)
    const spinner = indicator(page)
    await expect(spinner).toBeVisible({ timeout: 20_000 })
    await expect(spinner).toHaveAttribute("data-ai-status", "running")
    await expect(spinner).toHaveAttribute("data-ai-kind", "dub")

    // Named for a person, never an internal id.
    const label = await spinner.getAttribute("aria-label")
    expect(label).toContain("Arabic dub")
    expect(label).not.toMatch(/[0-9a-f]{20,}/)

    // It sits on the picture, not over the title.
    const titleBox = await card(page).getByText(`${FIXTURE}.mp4`).boundingBox()
    const spinnerBox = await spinner.boundingBox()
    expect(spinnerBox!.y + spinnerBox!.height).toBeLessThan(titleBox!.y)
  })

  test("hovering says which operation, which stage and how far", async ({ page }) => {
    await openVideos(page)
    await indicator(page).hover()

    /**
     * Scoped to the visible tooltip. Radix renders the content twice — once on
     * screen and once for assistive technology — so an unscoped test id matches
     * both and fails strict mode.
     */
    const tip = page.getByRole("tooltip").first()
    await expect(tip).toBeVisible()
    // The compact status the requirement asks for: operation, stage, counter.
    await expect(tip).toContainText("Arabic dub")
    await expect(tip.getByTestId("asset-ai-indicator-stage").first()).toHaveText(
      "Separating dialogue from background",
    )
    await expect(tip.getByTestId("asset-ai-indicator-progress").first()).toHaveText(
      "39 / 122 · 32%",
    )
  })

  test("survives a reload, because the state is the server's", async ({ page }) => {
    await openVideos(page)
    await expect(indicator(page)).toBeVisible()

    await page.reload()
    await expect(card(page)).toBeVisible({ timeout: 60_000 })
    await expect(indicator(page)).toBeVisible({ timeout: 20_000 })
    await expect(indicator(page)).toHaveAttribute("data-ai-status", "running")
  })

  test("survives leaving the page and coming back", async ({ page }) => {
    await openVideos(page)
    await expect(indicator(page)).toBeVisible()

    // Away, properly — a different route with its own data.
    await page.goto("/documents")
    await page.waitForLoadState("networkidle").catch(() => {})
    await openVideos(page)

    await expect(indicator(page)).toBeVisible({ timeout: 20_000 })
  })

  test("clicking it opens the panel on that dub, and starts nothing", async ({ page }) => {
    const generated: string[] = []
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/api\/assets\/[^/]+\/dubs$/.test(request.url())) {
        generated.push(request.url())
      }
    })

    await openVideos(page)
    await indicator(page).click()

    const panel = page.getByTestId("asset-side-panel")
    await expect(panel).toBeVisible({ timeout: 15_000 })
    // Straight to the running dub: AI, Dubbing, and the right language — not
    // Overview, and not whichever language happened to be first.
    await expect(panel.getByTestId("dubbing-section")).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByTestId("dub-progress-counter")).toHaveText("39 of 122 audio chunks")

    // Looking at a running job must never queue a second one.
    await page.waitForTimeout(2000)
    expect(generated, "opening progress must not start a dub").toHaveLength(0)
  })

  test("each card carries its own state, not one shared flag", async ({ page }) => {
    /**
     * Two videos, one with a running dub and one without. A single global
     * `isDubbing` would light both up, and would be indistinguishable from
     * correct behaviour on a page with only one video — which is exactly why
     * this asserts on the second card rather than only the first.
     */
    await openVideos(page)
    await expect(indicator(page)).toBeVisible({ timeout: 20_000 })

    const quiet = card(page, "dev-video-promo")
    await expect(quiet).toBeVisible()
    await expect(quiet.getByTestId("asset-ai-indicator")).toHaveCount(0)

    // And exactly one indicator on the page, belonging to the right asset.
    await expect(page.getByTestId("asset-ai-indicator")).toHaveCount(1)
  })

  test("does not ask the server once per card", async ({ page }) => {
    /**
     * The scalability requirement, measured rather than argued. A per-card
     * request would show up here as one dubs call per asset on the page; the
     * summary rides along with the listing instead, so the count is zero.
     */
    const perCard: string[] = []
    page.on("request", (request) => {
      if (/\/api\/assets\/[^/]+\/dubs(\?|$)/.test(request.url())) perCard.push(request.url())
    })

    await openVideos(page)
    await page.waitForLoadState("networkidle").catch(() => {})
    await page.waitForTimeout(1500)

    expect(perCard, "listing must carry AI state, not fetch it per card").toHaveLength(0)
  })
})

test.describe("card language metadata", () => {
  test.setTimeout(120_000)

  test("counts the original alongside its translations", async ({ page }) => {
    await openVideos(page)
    /**
     * English original, Spanish and Arabic translations. Three is the number a
     * person would say out loud about this file; counting only translations
     * reads as though the original does not exist.
     */
    await expect(card(page).getByTestId("asset-ai-languages")).toHaveText("3 languages")
  })

  test("keeps the footer at the same height whether or not there are translations", async ({
    page,
  }) => {
    await openVideos(page)

    /**
     * The structural requirement. A card whose language line vanishes has a
     * footer a few pixels higher than the ones beside it, and in a grid that
     * reads as misalignment rather than as absence — so the line is always
     * rendered, even when the honest answer is "1 language".
     */
    const withLanguages = card(page)
    const withoutLanguages = card(page, "dev-video-promo")
    await expect(withoutLanguages).toBeVisible()

    await expect(withLanguages.getByTestId("asset-ai-metadata")).toBeVisible()
    await expect(withoutLanguages.getByTestId("asset-ai-metadata")).toBeVisible()
    await expect(withoutLanguages.getByTestId("asset-ai-languages")).toHaveText("1 language")

    // Footers land on the same line, measured rather than assumed.
    const a = await withLanguages.getByTestId("asset-card-footer").boundingBox()
    const b = await withoutLanguages.getByTestId("asset-card-footer").boundingBox()
    expect(Math.abs(a!.y - b!.y), "footers must share a baseline").toBeLessThan(2)
  })

  test("puts the language count on the metadata row, not beside the title", async ({ page }) => {
    await openVideos(page)
    // The title needs the full width to truncate naturally; a count beside it
    // eats the part of a filename that tells one recording from another.
    const title = await card(page).getByText(`${FIXTURE}.mp4`).boundingBox()
    const languages = await card(page).getByTestId("asset-ai-languages").boundingBox()
    expect(languages!.y).toBeGreaterThan(title!.y + title!.height - 2)
  })

  test("keeps permanent metadata visible while another language generates", async ({ page }) => {
    await openVideos(page)
    // Both at once: the transient spinner must not displace what already exists.
    await expect(indicator(page)).toBeVisible()
    await expect(card(page).getByTestId("asset-ai-metadata")).toBeVisible()
    await expect(card(page).getByTestId("asset-ai-languages")).toHaveText("3 languages")
  })

  test("says nothing at all about a file with no language work", async ({ page }) => {
    await page.goto("/images")
    const image = page.locator('[data-asset-id="e2e-image-fixture"]')
    await expect(image).toBeVisible({ timeout: 60_000 })
    // An untouched file gets no badge, no spinner, and no empty row where one
    // would have been.
    await expect(image.getByTestId("asset-ai-metadata")).toHaveCount(0)
    await expect(image.getByTestId("asset-ai-indicator")).toHaveCount(0)
  })
})

test.describe("card failure state", () => {
  test.setTimeout(120_000)

  /** Rewrites the listing so the seeded dub reads as failed. */
  async function failTheDub(page: Page) {
    await page.route(/\/api\/assets\/page(\?|$)/, async (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      const response = await route.fetch()
      const body = (await response.json()) as {
        data: { items: { id: string; ai?: Record<string, unknown> }[] }
      }
      for (const item of body.data.items) {
        if (item.id !== FIXTURE || !item.ai) continue
        item.ai.activity = {
          active: false,
          kind: "dub",
          label: "Arabic dub",
          stage: null,
          percent: null,
          current: null,
          total: null,
          updatedAt: new Date().toISOString(),
          status: "failed",
          language: RUNNING,
        }
      }
      return route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(body),
      })
    })
  }

  test("stops spinning and shows a failed state instead", async ({ page }) => {
    await failTheDub(page)
    await openVideos(page)

    const failed = indicator(page)
    await expect(failed).toBeVisible({ timeout: 20_000 })
    // The defect this prevents: a spinner that turns forever on a job that
    // stopped an hour ago.
    await expect(failed).toHaveAttribute("data-ai-status", "failed")
    await expect(failed.locator(".animate-spin")).toHaveCount(0)
  })

  test("hovering a failure explains it, and clicking opens where Retry is", async ({ page }) => {
    await failTheDub(page)
    await openVideos(page)

    await indicator(page).hover()
    await expect(page.getByRole("tooltip").first()).toContainText("Open AI for details")

    await indicator(page).click()
    const panel = page.getByTestId("asset-side-panel")
    await expect(panel.getByTestId("dubbing-section")).toBeVisible({ timeout: 20_000 })
  })
})
