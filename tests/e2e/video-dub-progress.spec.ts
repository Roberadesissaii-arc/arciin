import { expect, test, type Page } from "@playwright/test"

/**
 * What a dub in progress tells the person waiting for it.
 *
 * This suite exists because of a specific, observed failure. A real 11:51 video
 * spent half an hour separating while the panel said only "Separating dialogue
 * from background" — and the separator was printing `39/122` the whole time.
 * Arciin had the information and was throwing it away.
 *
 * The fixture is therefore seeded at exactly 39 of 122: the point that real job
 * reached before the old wall-clock timeout killed it.
 *
 * Every number asserted here has to come from the persisted row. That is checked
 * the only way it can be — by reloading, navigating away and back, and confirming
 * the same figures return. A client-side timer would not survive any of that,
 * which is precisely why it is not allowed to be one.
 */

const FIXTURE = "e2e-video-transcript-fixture"
const RUNNING = "ar"
const READY = "es"

const panel = (page: Page) => page.getByTestId("asset-side-panel")

async function openDubbing(page: Page, language = RUNNING) {
  await page.goto("/videos")
  const card = page.locator(`[data-asset-id="${FIXTURE}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click()
  await expect(panel(page)).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("asset-panel-tab-ai").click()
  await panel(page).getByTestId("video-ai-tab-dubbing").click()
  await expect(panel(page).getByTestId("dubbing-section")).toBeVisible({ timeout: 20_000 })
  await panel(page).getByTestId(`dub-language-${language}`).click()
}

/**
 * Rewrite one dub's persisted state for the duration of a test.
 *
 * Through the API's own responses rather than the database, so a test can put
 * the row in a state that would otherwise need a real failure or a forty-minute
 * wait — without a worker, and without leaving the shared dev instance dirty.
 */
async function stubDub(page: Page, patch: Record<string, unknown>) {
  await page.route(/\/api\/assets\/[^/]+\/dubs(\?|$)/, async (route) => {
    // fallback, not continue: another handler in the same test may want the
    // POST, and continue would send it to the network past them.
    if (route.request().method() !== "GET") return route.fallback()
    const response = await route.fetch()
    const body = (await response.json()) as {
      data: { dubs: Record<string, unknown>[] }
    }
    body.data.dubs = body.data.dubs.map((dub) =>
      dub.language === RUNNING ? { ...dub, ...patch } : dub,
    )
    // Built explicitly rather than reusing the fetched response object, which
    // Playwright disposes once its body has been read.
    return route.fulfill({
      status: response.status(),
      contentType: "application/json",
      body: JSON.stringify(body),
    })
  })
}

test.describe("dub progress", () => {
  test.setTimeout(180_000)

  test("shows the separator's real counter, not just a stage name", async ({ page }) => {
    await openDubbing(page)
    const progress = panel(page).getByTestId("dub-progress")
    await expect(progress).toBeVisible({ timeout: 20_000 })

    // The stage, as before.
    await expect(progress.getByTestId("dub-progress-stage")).toHaveText(
      "Separating dialogue from background",
    )

    // And the part that was missing: the actual numbers, with their unit named,
    // because "39 of 122" alone does not say what is being counted.
    await expect(progress.getByTestId("dub-progress-counter")).toHaveText("39 of 122 audio chunks")
    await expect(progress.getByTestId("dub-progress-percent")).toHaveText("32%")

    // A real bar at a real value, read off the element rather than the text.
    const bar = progress.getByTestId("dub-progress-bar")
    await expect(bar).toHaveAttribute("data-state", "loading")
    await expect(bar).toHaveAttribute("aria-valuenow", "32")
  })

  test("says the work is local and survives leaving the page", async ({ page }) => {
    await openDubbing(page)
    const notice = panel(page).getByTestId("dub-progress-notice")
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(/Running locally/i)
    // The two things a person waiting forty minutes needs to know.
    await expect(notice).toContainText(/can take a while/i)
    await expect(notice).toContainText(/keeps going/i)
  })

  test("never claims to be almost done, and never guesses a finish time", async ({ page }) => {
    await openDubbing(page)
    const progress = panel(page).getByTestId("dub-progress")
    const text = await progress.innerText()

    /**
     * On this CPU a chunk takes between thirty-five and sixty seconds, and that
     * variance is the whole problem: an estimate built on it would be wrong by
     * many minutes. Being told "about 12 minutes left" for forty minutes is
     * worse than being told nothing.
     */
    for (const forbidden of ["almost done", "nearly", "remaining", "eta", "minutes left"]) {
      expect(text.toLowerCase(), `must not claim ${forbidden}`).not.toContain(forbidden)
    }
  })

  test("the numbers come from the server, so a reload does not lose them", async ({ page }) => {
    await openDubbing(page)
    await expect(panel(page).getByTestId("dub-progress-counter")).toHaveText("39 of 122 audio chunks")

    await page.reload()
    await openDubbing(page)

    // A client-side timer would restart here. A persisted counter does not.
    await expect(panel(page).getByTestId("dub-progress-counter")).toHaveText("39 of 122 audio chunks")
    await expect(panel(page).getByTestId("dub-progress-percent")).toHaveText("32%")
  })

  test("shows an indeterminate bar when a stage genuinely cannot count", async ({ page }) => {
    await stubDub(page, {
      status: "PREPARING",
      stage: "Preparing audio",
      progressPercent: null,
      progressCurrent: null,
      progressTotal: null,
    })
    await openDubbing(page)

    const progress = panel(page).getByTestId("dub-progress")
    await expect(progress.getByTestId("dub-progress-stage")).toHaveText("Preparing audio")
    // Honest about not knowing, rather than showing a made-up percentage.
    await expect(progress.getByTestId("dub-progress-bar")).toHaveAttribute(
      "data-state",
      "indeterminate",
    )
    await expect(progress.getByTestId("dub-progress-percent")).toHaveCount(0)
    await expect(progress.getByTestId("dub-progress-counter")).toHaveText("Starting…")
  })

  test("admits when it has not heard anything for a long time", async ({ page }) => {
    // Eleven minutes since the counter last moved.
    await stubDub(page, {
      progressUpdatedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    })
    await openDubbing(page)

    const stalled = panel(page).getByTestId("dub-progress-stalled")
    await expect(stalled).toBeVisible()
    await expect(stalled).toContainText(/Still processing/i)
    await expect(stalled).toContainText(/11 min ago/)
    // Still not a failure claim: a slow separation must not be called broken.
    await expect(stalled).not.toContainText(/fail/i)
  })

  test("shows the ready dub's own state, not the running one's", async ({ page }) => {
    await openDubbing(page, READY)
    // Two languages on one asset, one running and one finished: switching must
    // not carry the running language's progress across.
    await expect(panel(page).getByTestId("dub-progress")).toHaveCount(0)
    await expect(panel(page).getByTestId("use-dub-audio")).toBeVisible()
  })
})

test.describe("dub failure", () => {
  test.setTimeout(120_000)

  /** The real thing, near enough: a command line and pages of Python logging. */
  const RAW_DUMP = [
    "Command failed: /srv/arce-projects/arciin-separator/bin/audio-separator",
    ...Array.from({ length: 60 }, (_, i) => `INFO - common_separator - noise line ${i}`),
    "RuntimeError: the separator gave up",
  ].join("\n")

  test("shows a sentence, not a wall of process output", async ({ page }) => {
    await stubDub(page, {
      status: "FAILED",
      stage: null,
      error: "Audio separation failed. audio-separator exited with code 1.",
      errorDetail: RAW_DUMP,
      progressPercent: null,
    })
    await openDubbing(page)

    const failure = panel(page).getByTestId("dub-failure")
    await expect(failure).toBeVisible()
    await expect(failure).toContainText("Audio separation failed")
    await expect(failure).toContainText(/could not finish processing this video/i)

    /**
     * The defect this replaced: the raw command dump was the error message, so
     * the panel rendered the server's own directory layout and sixty lines of
     * logging with nothing a reader could act on.
     */
    await expect(failure).not.toContainText("Command failed:")
    await expect(failure).not.toContainText("/srv/arce-projects")

    // Retry is right there, because that is what most people want next.
    await expect(failure.getByTestId("dub-retry")).toBeVisible()
  })

  test("keeps the technical output collapsed until asked for", async ({ page }) => {
    await stubDub(page, {
      status: "FAILED",
      error: "Audio separation failed. audio-separator exited with code 1.",
      errorDetail: RAW_DUMP,
    })
    await openDubbing(page)

    const failure = panel(page).getByTestId("dub-failure")
    await expect(failure.getByTestId("dub-error-details")).toHaveCount(0)

    await failure.getByTestId("dub-error-details-toggle").click()
    const details = failure.getByTestId("dub-error-details")
    await expect(details).toBeVisible()
    await expect(details).toContainText("RuntimeError: the separator gave up")
  })

  test("retrying starts the dub again rather than a second one", async ({ page }) => {
    const posted: unknown[] = []
    await page.route(/\/api\/assets\/[^/]+\/dubs$/, async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      posted.push(route.request().postDataJSON())
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { dub: null } }),
      })
    })
    await stubDub(page, { status: "FAILED", error: "Audio separation failed.", errorDetail: "x" })
    await openDubbing(page)

    await panel(page).getByTestId("dub-retry").click()
    await expect.poll(() => posted.length, { timeout: 15_000 }).toBe(1)
    // The same language it failed on, not whatever happened to be selected.
    expect((posted[0] as { language?: string }).language).toBe(RUNNING)
  })

  test("explains a memory kill in terms a person can act on", async ({ page }) => {
    await stubDub(page, {
      status: "FAILED",
      error:
        "Audio separation failed. audio-separator was stopped by the system, most likely because it ran out of memory.",
      errorDetail: "SIGKILL",
    })
    await openDubbing(page)
    const failure = panel(page).getByTestId("dub-failure")
    await expect(failure).toContainText(/memory/i)
    await expect(failure).toContainText(/shorter video/i)
  })
})

test.describe("the quiet phase after the last chunk", () => {
  test.setTimeout(120_000)

  /**
   * The state a real 11:51 run spent thirty-five minutes in.
   *
   * Demucs' counter measures its chunk loop. When that loop ends it still has
   * to overlap-add every chunk into four full-length stems and write them —
   * observed holding a gigabyte of float arrays and emitting nothing at all. The
   * panel showed a full bar, "Estimating time…", and "Still processing. Last
   * progress update 37 min ago", which together read as a hung job.
   */
  async function finalisingState(page: Page) {
    await stubDub(page, {
      status: "SEPARATING",
      stage: "Separating dialogue from background",
      progressCurrent: 122,
      progressTotal: 122,
      progressPercent: 100,
      // Long enough that the old stall notice would have fired.
      progressUpdatedAt: new Date(Date.now() - 37 * 60_000).toISOString(),
    })
  }

  test("does not claim the stage is finished", async ({ page }) => {
    await finalisingState(page)
    await openDubbing(page)

    const progress = panel(page).getByTestId("dub-progress")
    await expect(progress.getByTestId("dub-progress-stage")).toHaveText(
      "Finalising separated audio",
    )
    // A full determinate bar beside unfinished work is the claim that misled.
    await expect(progress.getByTestId("dub-progress-bar")).toHaveAttribute(
      "data-state",
      "indeterminate",
    )
    await expect(progress.getByTestId("dub-progress-percent")).toHaveCount(0)
  })

  test("explains that this phase is silent by design", async ({ page }) => {
    await finalisingState(page)
    await openDubbing(page)

    await expect(panel(page).getByTestId("dub-progress-finalising")).toContainText(
      /reports no progress/i,
    )
    // The counter still says the chunks are done, because they are.
    await expect(panel(page).getByTestId("dub-progress-counter")).toContainText(
      /All audio chunks separated/i,
    )
  })

  test("does not accuse a working job of having stalled", async ({ page }) => {
    await finalisingState(page)
    await openDubbing(page)

    /**
     * Thirty-seven minutes of silence would normally be worth flagging. Here it
     * is expected, and saying "last update 37 min ago" next to a spinner is how
     * a correct job came to look broken.
     */
    await expect(panel(page).getByTestId("dub-progress-stalled")).toHaveCount(0)
  })

  test("stops offering an estimate for work that is already counted", async ({ page }) => {
    await finalisingState(page)
    await openDubbing(page)

    // "Estimating time…" reappearing after a real figure reads as the estimate
    // giving up, rather than as the work having moved on.
    await expect(panel(page).getByTestId("dub-progress-eta")).toHaveCount(0)
  })

  test("still warns about a genuine stall before the chunks are done", async ({ page }) => {
    // The notice must not be lost — only silenced where silence is expected.
    await stubDub(page, {
      progressCurrent: 39,
      progressTotal: 122,
      progressPercent: 32,
      progressUpdatedAt: new Date(Date.now() - 37 * 60_000).toISOString(),
    })
    await openDubbing(page)
    await expect(panel(page).getByTestId("dub-progress-stalled")).toBeVisible()
  })
})
