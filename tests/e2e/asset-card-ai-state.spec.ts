import { expect, test, type Page } from "@playwright/test"

/**
 * What a card says about AI work and about languages, with nothing open.
 *
 * Two separate things, deliberately kept apart.
 *
 * The **transient** state — something is running, or something failed — lives on
 * the thumbnail, is the server's, and is asserted through a rewritten listing
 * rather than by starting a real job: what matters here is that a card renders
 * what the server reports, not that a worker can be made to report it.
 *
 * The **permanent** state — how many languages this file has — lives under the
 * title beside the size and the date, because it is a property of the file
 * rather than an event. It is counted from the transcript and its saved
 * translations and from nothing else.
 *
 * The other requirement is that knowing costs nothing per card. A grid of two
 * hundred videos must not become two hundred status requests, so the request
 * count is asserted directly rather than assumed from how the code reads.
 */

const FIXTURE = "e2e-video-transcript-fixture"

const card = (page: Page, assetId = FIXTURE) => page.locator(`[data-asset-id="${assetId}"]`)
const indicator = (page: Page) => card(page).getByTestId("asset-ai-indicator")

async function openVideos(page: Page) {
  await page.goto("/videos")
  await expect(card(page)).toBeVisible({ timeout: 60_000 })
}

/**
 * Rewrite the listing so the fixture reads as mid-transcription.
 *
 * The seeded transcript is finished, and generating a real one costs a provider
 * call on every run. The card's contract is with the listing payload, so the
 * payload is what is varied.
 */
async function withActivity(
  page: Page,
  activity: Record<string, unknown> | null,
) {
  await page.route(/\/api\/assets\/page(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    const response = await route.fetch()
    const body = (await response.json()) as {
      data: { items: { id: string; ai?: Record<string, unknown> }[] }
    }
    for (const item of body.data.items) {
      if (item.id === FIXTURE && item.ai) item.ai.activity = activity
    }
    return route.fulfill({
      status: response.status(),
      contentType: "application/json",
      body: JSON.stringify(body),
    })
  })
}

const RUNNING_TRANSCRIPT = {
  active: true,
  kind: "transcript",
  label: "Transcript",
  stage: "Generating transcript",
  updatedAt: new Date().toISOString(),
  status: "running",
}

test.describe("card AI indicator", () => {
  test.setTimeout(120_000)

  test("shows running work on the thumbnail without opening anything", async ({ page }) => {
    await withActivity(page, RUNNING_TRANSCRIPT)
    await openVideos(page)

    const spinner = indicator(page)
    await expect(spinner).toBeVisible({ timeout: 20_000 })
    await expect(spinner).toHaveAttribute("data-ai-status", "running")
    await expect(spinner).toHaveAttribute("data-ai-kind", "transcript")

    // Named for a person, never an internal id.
    const label = await spinner.getAttribute("aria-label")
    expect(label).toContain("Transcript")
    expect(label).not.toMatch(/[0-9a-f]{20,}/)

    // It sits on the picture, not over the title.
    const titleBox = await card(page).getByText(`${FIXTURE}.mp4`).boundingBox()
    const spinnerBox = await spinner.boundingBox()
    expect(spinnerBox!.y + spinnerBox!.height).toBeLessThan(titleBox!.y)
  })

  test("hovering says which operation and what it is doing", async ({ page }) => {
    await withActivity(page, RUNNING_TRANSCRIPT)
    await openVideos(page)
    await indicator(page).hover()

    /**
     * Scoped to the visible tooltip. Radix renders the content twice — once on
     * screen and once for assistive technology — so an unscoped test id matches
     * both and fails strict mode.
     */
    const tip = page.getByRole("tooltip").first()
    await expect(tip).toBeVisible()
    await expect(tip).toContainText("Transcript")
    await expect(tip.getByTestId("asset-ai-indicator-stage").first()).toHaveText(
      "Generating transcript",
    )
  })

  test("each card carries its own state, not one shared flag", async ({ page }) => {
    /**
     * Two videos, one working and one not. A single global `isBusy` would light
     * both up, and would be indistinguishable from correct behaviour on a page
     * with only one video — which is why this asserts on the second card rather
     * than only the first.
     */
    await withActivity(page, RUNNING_TRANSCRIPT)
    await openVideos(page)
    await expect(indicator(page)).toBeVisible({ timeout: 20_000 })

    const quiet = card(page, "dev-video-promo")
    await expect(quiet).toBeVisible()
    await expect(quiet.getByTestId("asset-ai-indicator")).toHaveCount(0)

    await expect(page.getByTestId("asset-ai-indicator")).toHaveCount(1)
  })

  test("clicking it opens the panel on the AI section", async ({ page }) => {
    await withActivity(page, RUNNING_TRANSCRIPT)
    await openVideos(page)
    await indicator(page).click()

    /**
     * Videos open the AI workspace in the drawer.
     *
     * Edit and AI were unified into one surface, so the indicator no longer
     * routes a video through the single-asset side panel. The claim this test
     * makes is unchanged — clicking the indicator lands on the work rather
     * than on Overview — only the surface hosting it moved.
     */
    const workspace = page.getByTestId("video-edit-drawer")
    await expect(workspace).toBeVisible({ timeout: 15_000 })
    await expect(workspace.getByTestId("video-ai-nav")).toBeVisible({ timeout: 20_000 })
  })

  test("does not ask the server once per card", async ({ page }) => {
    /**
     * The scalability requirement, measured rather than argued. A per-card
     * request would show up here as one AI call per asset on the page; the
     * summary rides along with the listing instead, so the count is zero.
     */
    const perCard: string[] = []
    page.on("request", (request) => {
      if (/\/api\/assets\/[^/]+\/(transcript|title-suggestions)(\?|$)/.test(request.url())) {
        perCard.push(request.url())
      }
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

  test("keeps permanent metadata visible while something is running", async ({ page }) => {
    await withActivity(page, RUNNING_TRANSCRIPT)
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

  const FAILED_TRANSCRIPT = {
    active: false,
    kind: "transcript",
    label: "Transcript",
    stage: null,
    updatedAt: new Date().toISOString(),
    status: "failed",
  }

  test("stops spinning and shows a failed state instead", async ({ page }) => {
    await withActivity(page, FAILED_TRANSCRIPT)
    await openVideos(page)

    const failed = indicator(page)
    await expect(failed).toBeVisible({ timeout: 20_000 })
    // The defect this prevents: a spinner that turns forever on a job that
    // stopped an hour ago.
    await expect(failed).toHaveAttribute("data-ai-status", "failed")
    await expect(failed.locator(".animate-spin")).toHaveCount(0)
  })

  test("hovering a failure explains it, and clicking opens where Retry is", async ({ page }) => {
    await withActivity(page, FAILED_TRANSCRIPT)
    await openVideos(page)

    await indicator(page).hover()
    await expect(page.getByRole("tooltip").first()).toContainText("Open AI for details")

    await indicator(page).click()
    /**
     * Same unified workspace as above.
     *
     * Retry itself is not asserted here: the failure in this test is stubbed on
     * the card's activity feed, while the drawer loads the fixture's real
     * transcript, which is READY. Asserting Retry would be asserting a state
     * this fixture never reaches.
     */
    const workspace = page.getByTestId("video-edit-drawer")
    await expect(workspace.getByTestId("video-ai-nav")).toBeVisible({ timeout: 20_000 })
  })
})
