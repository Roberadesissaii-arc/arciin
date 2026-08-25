import { expect, test, type Page } from "@playwright/test"

/**
 * Title and Summarize stay usable while a transcript is being prepared.
 *
 * The three Assist tabs share one transcript, so they are coupled in the data.
 * They must not be coupled in the interface: starting a transcript on the
 * Transcript tab used to replace the Generate button on the other two with a
 * dead-end "Waiting for transcript…", so a reader who wanted a title had to sit
 * and watch. Asking now queues onto the running job.
 *
 * The transcript endpoint is stubbed rather than really run: the property under
 * test is what the panel does while a transcript is in flight, and a real
 * transcription would cost a Gemini call to reach the same state.
 */

const FIXTURE = "e2e-video-transcript-fixture"

const panel = (page: Page) => page.getByTestId("video-edit-drawer")

/** The transcript row the panel polls, in whatever state a test needs. */
function stubTranscript(page: Page, status: string) {
  return page.route(`**/assets/${FIXTURE}/transcript`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback()
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          transcript: {
            id: "stub-transcript",
            assetId: FIXTURE,
            status,
            language: "en",
            segments: status === "READY" ? [{ startMs: 0, text: "Hello there." }] : [],
            fullText: status === "READY" ? "Hello there." : "",
            aiInsight: null,
            error: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          translations: [],
          transcribable: true,
        },
      }),
    })
  })
}

async function openAssist(page: Page) {
  await page.goto("/videos")
  const card = page.locator(`[data-asset-id="${FIXTURE}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click({ button: "right" })
  await page.getByTestId("asset-menu-ai").click()
  await expect(panel(page)).toBeVisible({ timeout: 15_000 })
  await expect(panel(page).getByTestId("video-ai-nav")).toBeVisible({ timeout: 20_000 })
}

test.describe("Assist tabs do not block each other", () => {
  test.setTimeout(120_000)

  test("Title can be asked for while a transcript is processing", async ({ page }) => {
    await stubTranscript(page, "PROCESSING")

    // Any second transcript POST would mean the tab started duplicate work.
    const transcriptPosts: string[] = []
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/assets\/[^/]+\/transcript$/.test(r.url())) {
        transcriptPosts.push(r.url())
      }
    })

    await openAssist(page)
    await panel(page).getByRole("button", { name: /^Title$/ }).click()

    // The regression: this button was replaced by "Waiting for transcript…".
    const generate = panel(page).getByTestId("generate-ai-title")
    await expect(generate).toBeVisible({ timeout: 15_000 })
    await expect(generate).toBeEnabled()
    await expect(panel(page).getByText("Waiting for transcript…")).toHaveCount(0)

    await generate.click()

    // Queued onto the running transcript, not a second one.
    await expect(
      panel(page).getByText(/Preparing a transcript, then suggesting titles/i),
    ).toBeVisible({ timeout: 15_000 })
    expect(transcriptPosts, "no duplicate transcript queued").toHaveLength(0)
  })

  test("Summarize can be asked for while a transcript is processing", async ({ page }) => {
    await stubTranscript(page, "PROCESSING")

    const transcriptPosts: string[] = []
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/assets\/[^/]+\/transcript$/.test(r.url())) {
        transcriptPosts.push(r.url())
      }
    })

    await openAssist(page)
    await panel(page).getByRole("button", { name: /^Summarize$/ }).click()

    const generate = panel(page).getByTestId("generate-ai-summary")
    await expect(generate).toBeVisible({ timeout: 15_000 })
    await expect(generate).toBeEnabled()
    await expect(panel(page).getByText("Waiting for transcript…")).toHaveCount(0)

    await generate.click()
    expect(transcriptPosts, "no duplicate transcript queued").toHaveLength(0)
  })

  test("both tabs can be queued in the same run", async ({ page }) => {
    await stubTranscript(page, "PROCESSING")
    await openAssist(page)

    await panel(page).getByRole("button", { name: /^Title$/ }).click()
    await panel(page).getByTestId("generate-ai-title").click()

    await panel(page).getByRole("button", { name: /^Summarize$/ }).click()
    await panel(page).getByTestId("generate-ai-summary").click()

    // Back on Title, the request placed before the tab switch is still pending —
    // the tabs stay mounted, so neither cancels the other.
    await panel(page).getByRole("button", { name: /^Title$/ }).click()
    await expect(
      panel(page).getByText(/Preparing a transcript, then suggesting titles/i),
    ).toBeVisible({ timeout: 15_000 })
  })
})
