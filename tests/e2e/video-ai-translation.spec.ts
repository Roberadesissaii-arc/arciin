import { expect, test, type Page } from "@playwright/test"

import { geminiKeyConfigured } from "./gemini-fixture"

/**
 * Translation and AI titles, in the panel a reader actually uses.
 *
 * The expensive property being protected is that neither feature touches the
 * media. The transcript already exists, so translating it and naming the video
 * from it are text questions — re-uploading the footage to re-derive words the
 * instance is holding would cost money and send the recording somewhere it
 * does not need to go again.
 */

const FIXTURE = "e2e-video-transcript-fixture"
const ORIGINAL_NAME = "e2e-video-transcript-fixture.mp4"

/** Opt-in, and only when a credential was actually provisioned. */
const REAL = process.env.E2E_TRANSCRIPT === "1" && geminiKeyConfigured()

/** AI workspace — the video drawer (Edit was removed; AI is the one entry). */
const panel = (page: Page) => page.getByTestId("video-edit-drawer")

async function openAiSection(page: Page) {
  await page.goto("/videos")
  const card = page.locator(`[data-asset-id="${FIXTURE}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click({ button: "right" })
  await page.getByTestId("asset-menu-ai").click()
  await expect(panel(page)).toBeVisible({ timeout: 15_000 })
  await expect(panel(page).getByTestId("video-ai-nav")).toBeVisible({ timeout: 20_000 })
}

/** Every request that carried media bytes to our own API. */
function watchMediaRequests(page: Page): string[] {
  const hits: string[] = []
  page.on("request", (request) => {
    const url = request.url()
    // The download endpoint is how bytes leave the instance. A translation or
    // a title must never cause one beyond the player's own playback.
    if (/\/api\/assets\/[^/]+\/(download|transcript)$/.test(url) && request.method() === "POST") {
      hits.push(`${request.method()} ${url}`)
    }
  })
  return hits
}

test.describe("translation and titles never reach for the media", () => {
  test.setTimeout(180_000)

  test("opening the panel and the AI section queues nothing", async ({ page }) => {
    const posts = watchMediaRequests(page)
    await openAiSection(page)
    await page.waitForTimeout(3000)

    // Looking is not asking. A transcript POST here would be a charge nobody
    // requested, on a video somebody merely selected.
    expect(posts, "no transcription queued by looking").toHaveLength(0)
  })

  test("another user's asset id buys nothing", async ({ page }) => {
    await page.goto("/videos")
    await expect(page.locator(`[data-asset-id="${FIXTURE}"]`)).toBeVisible({ timeout: 60_000 })

    // Every endpoint that spends money or reads private speech re-checks the
    // asset rather than trusting a caller who knows an id.
    for (const path of ["transcript/translations", "title-suggestions"]) {
      const status = await page.evaluate(async (p) => {
        const res = await fetch(`/api/assets/not-my-asset/${p}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: "es" }),
        })
        return res.status
      }, path)
      expect(status, `${path} must not serve an unknown asset`).toBe(404)
    }

    // Reading someone else's transcript is the same answer as reading a file
    // that does not exist — the endpoint is not an existence oracle either.
    const readStatus = await page.evaluate(async () => {
      const res = await fetch("/api/assets/not-my-asset/transcript", { credentials: "include" })
      return res.status
    })
    expect(readStatus, "reading a transcript must not serve an unknown asset").toBe(404)
  })

  test("the language selector is searchable and refuses the source language", async ({ page }) => {
    await openAiSection(page)
    await expect(panel(page).getByTestId("transcript-language-bar")).toBeVisible({ timeout: 20_000 })

    await panel(page).getByTestId("transcript-language-switcher").click()

    /**
     * The menu and the picker are portaled to document.body, so they are not
     * inside the drawer and must not be looked for there.
     *
     * They were moved out deliberately — a menu rendered inside the drawer gets
     * clipped by its overflow — but the locators were still scoped to the
     * drawer, so the click waited three minutes for an element that renders
     * correctly, just somewhere else in the DOM. The trigger stays
     * drawer-scoped, because that really is in the drawer.
     */
    await page.getByTestId("transcript-translate-another").click()
    const picker = page.getByTestId("transcript-language-picker")
    await expect(picker).toBeVisible()

    /**
     * A broad list, not a handful.
     *
     * Languages already saved for this video are deliberately absent — offering
     * one would invite a paid request that could only return what exists — so
     * this asserts on tags no test translates into and the fixture does not
     * seed, keeping it independent of whatever an earlier run left behind.
     */
    /**
     * Offered, asserted by presence rather than by visibility.
     *
     * `toBeVisible()` scrolls each match into view, and doing that for nine
     * tags drags the pointer through a ninety-language scroll box before the
     * search below is typed into — after which the keystrokes did not land and
     * the filter assertion failed on a list that filters correctly when a
     * person uses it. The claim here is that each language is *offered*, which
     * is what `toHaveCount(1)` says, and it says it without synthesising a
     * scroll storm first.
     */
    for (const tag of ["am", "om", "fr", "zh", "ja", "ko", "hi", "pt", "de"]) {
      await expect(picker.getByTestId(`transcript-target-${tag}`)).toHaveCount(1)
    }

    // English is the transcript's own language: translating to it is a paid
    // request that could only return its input, so it is not offered.
    await expect(picker.getByTestId("transcript-target-en")).toHaveCount(0)

    // And neither are the languages this video already has. The fixture seeds
    // Spanish and Arabic, and offering either would spend money to reproduce a
    // translation that is already saved.
    for (const saved of ["es", "ar"]) {
      await expect(picker.getByTestId(`transcript-target-${saved}`)).toHaveCount(0)
    }

    // Presence, not visibility, for the same reason as the list above: a
    // scroll-into-view between typing and asserting is what made this read a
    // filter that had already worked as one that had not.
    await picker.getByTestId("transcript-language-search").fill("amhar")
    await expect(picker.getByTestId("transcript-target-am")).toHaveCount(1)
    await expect(picker.getByTestId("transcript-target-fr")).toHaveCount(0)
  })

  test("the AI Title placeholder actually generates a transcript", async ({ page }) => {
    /**
     * The button used to only switch tabs.
     *
     * It says "Generate transcript", so pressing it must queue one — the old
     * behaviour moved the reader to another placeholder and left them to press
     * a second, identical button, which reads as the feature being broken.
     *
     * The transcript is stubbed absent so the empty state renders, and the POST
     * is fulfilled rather than forwarded: this proves the wiring without paying
     * for a transcription or disturbing the fixture.
     */
    const posted: string[] = []
    await page.route(/\/api\/assets\/[^/]+\/transcript(\?|$)/, async (route) => {
      const method = route.request().method()
      if (method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { transcript: null, translations: [], transcribable: true } }),
        })
      }
      if (method === "POST") {
        posted.push(route.request().url())
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            data: { transcript: { id: "stub", assetId: "stub", status: "PENDING", segments: [] } },
          }),
        })
      }
      return route.continue()
    })

    await openAiSection(page)
    await page.getByTestId("video-ai-tab-title").click()

    const empty = panel(page).getByTestId("ai-title-needs-transcript")
    await expect(empty).toBeVisible({ timeout: 20_000 })
    // The same placeholder language and shape the transcript panel uses.
    await expect(empty).toContainText("AI title")
    await expect(empty).toContainText(/transcript/i)

    /**
     * One button, and it still has to queue the work.
     *
     * The empty state used to offer "Generate transcript", which switched tabs
     * and left a second identical button to press. It offers "Generate titles"
     * now and stays on Title while the transcript it needs is prepared — a
     * deliberate change, and a better one.
     *
     * What must not change is the property this test was written for: pressing
     * it queues a transcript rather than only moving the reader somewhere else.
     * That assertion is unchanged; only the control and the destination are.
     */
    await panel(page).getByTestId("generate-ai-title").click()

    await expect
      .poll(() => posted.length, { timeout: 15_000 })
      .toBeGreaterThan(0)

    // And the reader is still on Title rather than being moved to the
    // transcript tab — which is the whole point of the redesign.
    await expect(page.getByTestId("video-ai-tab-title")).toHaveAttribute(
      "aria-current",
      "page",
    )
  })

  test("AI Title asks for a transcript rather than starting one", async ({ page }) => {
    const posts = watchMediaRequests(page)
    await openAiSection(page)
    await page.getByTestId("video-ai-tab-title").click()

    // Either it offers to generate titles (a transcript exists) or it explains
    // what is missing — but it must never quietly begin transcribing.
    const section = panel(page).getByTestId("ai-title-section")
    const empty = panel(page).getByTestId("ai-title-needs-transcript")
    await expect(section.or(empty).first()).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(2000)
    expect(posts, "opening AI Title queues no transcription").toHaveLength(0)
  })
})

test.describe("a real translation", () => {
  test.skip(
    !REAL,
    process.env.E2E_TRANSCRIPT === "1"
      ? "Real Gemini E2E skipped: E2E_GEMINI_API_KEY not configured"
      : "set E2E_TRANSCRIPT=1 (with E2E_GEMINI_API_KEY) to spend Gemini tokens",
  )
  test.describe.configure({ mode: "serial", timeout: 10 * 60 * 1000 })

  test("translates the saved transcript, keeps its timings, and persists", async ({ page }) => {
    const posts = watchMediaRequests(page)
    await openAiSection(page)

    const transcript = panel(page).getByTestId("video-transcript")
    await expect(transcript.getByTestId("video-transcript-segments")).toBeVisible({
      timeout: 60_000,
    })

    // The timings the original carries, before anything is translated.
    const originalStamps = await transcript
      .getByTestId("transcript-timestamp")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-start-ms")))
    expect(originalStamps.length).toBeGreaterThan(0)
    console.log(`[ai] original timestamps: ${originalStamps.join(", ")}`)

    /**
     * Translate, whether or not a previous run already did.
     *
     * A saved language is deliberately absent from the "translate another"
     * picker, so a test that always reached for it would hang the second time
     * it ran. Existing Spanish is regenerated instead — which exercises the
     * regenerate path rather than skipping it.
     */
    await panel(page).getByTestId("transcript-language-switcher").click()
    const savedSpanish = panel(page).getByTestId("transcript-language-option-es")
    if ((await savedSpanish.count()) > 0) {
      await savedSpanish.click()
      await panel(page).getByTestId("transcript-regenerate-translation").click()
    } else {
      await panel(page).getByTestId("transcript-translate-another").click()
      await panel(page).getByTestId("transcript-target-es").click()
    }

    await expect(
      panel(page).getByTestId("transcript-language-switcher"),
      "the switcher moves to the new language",
    ).toContainText(/spanish/i, { timeout: 5 * 60 * 1000 })

    const translated = await transcript.getByTestId("video-transcript-segments").innerText()
    console.log(`[ai] spanish:\n${translated.slice(0, 300)}`)
    expect(translated.trim().length, "real translated text").toBeGreaterThan(10)

    // The timeline is the recording's, not the model's.
    const translatedStamps = await transcript
      .getByTestId("transcript-timestamp")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-start-ms")))
    expect(translatedStamps, "timings preserved exactly").toEqual(originalStamps)

    // No media left the instance to produce it.
    expect(posts, "translation must not queue transcription").toHaveLength(0)

    // ── seek from a translated timestamp ─────────────────────────────────
    const stamps = transcript.getByTestId("transcript-timestamp")
    const target = (await stamps.count()) > 1 ? stamps.nth(1) : stamps.first()
    const targetMs = Number(await target.getAttribute("data-start-ms"))
    await target.click()
    await expect
      .poll(
        async () =>
          panel(page)
            .getByTestId("video-edit-player")
            .locator("video")
            .evaluate((el) => (el as HTMLVideoElement).currentTime),
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(Math.max(0, targetMs / 1000 - 1))
    console.log(`[ai] translated seek to ${targetMs}ms verified`)

    // ── it survives a refresh, and reloading it costs nothing ────────────
    await page.reload()
    await openAiSection(page)
    await panel(page).getByTestId("transcript-language-switcher").click()
    await panel(page).getByTestId("transcript-language-option-es").click()
    await expect(panel(page).getByTestId("video-transcript-segments")).toBeVisible({
      timeout: 30_000,
    })
    expect(posts, "loading a saved language sends nothing").toHaveLength(0)
    console.log("[ai] translation persisted across refresh")

    // ── and the original is untouched ────────────────────────────────────
    await panel(page).getByTestId("transcript-language-switcher").click()
    await panel(page).getByTestId("transcript-language-option-original").click()
    await expect(panel(page).getByTestId("video-transcript")).toContainText(/your (server|control)/i, {
      timeout: 20_000,
    })
    console.log("[ai] original still intact")
  })

  test("suggests a real title and applies it without changing the extension", async ({ page }) => {
    const posts = watchMediaRequests(page)
    await openAiSection(page)
    await page.getByTestId("video-ai-tab-title").click()

    await panel(page).getByTestId("generate-ai-title").click()
    const options = panel(page).getByTestId("ai-title-option")
    await expect(options.first()).toBeVisible({ timeout: 5 * 60 * 1000 })

    const titles = await options.allInnerTexts()
    console.log(`[ai] title suggestions:\n  ${titles.join("\n  ")}`)
    expect(titles.length, "several choices").toBeGreaterThan(0)
    expect(posts, "titles must not queue transcription").toHaveLength(0)

    /**
     * What it will actually be called.
     *
     * Read from the preview rather than rebuilt from the suggestion: the
     * sanitiser legitimately rewrites characters a filename cannot carry — a
     * suggested "Scene: Files" becomes "Scene- Files" — and an earlier version
     * of this test asserted the raw title and failed a rename that was correct.
     */
    const preview = await panel(page).getByTestId("ai-title-preview").innerText()
    console.log(`[ai] ${preview}`)
    expect(preview, "extension preserved").toContain(".mp4")
    const applied = preview.replace(/^\s*Renames to\s*/i, "").trim()
    expect(applied.endsWith(".mp4"), "the model never chooses the extension").toBe(true)

    await panel(page).getByTestId("apply-ai-title").click()
    await page.reload()
    await page.goto("/videos")
    const card = page.locator(`[data-asset-id="${FIXTURE}"]`)
    await expect(card).toBeVisible({ timeout: 60_000 })
    await card.click()
    const overview = page.getByTestId("asset-side-panel")
    await expect(overview).toContainText(applied, { timeout: 20_000 })
    await expect(
      overview.getByTestId("asset-panel-preview").locator("video"),
      "still playable after rename",
    ).toBeVisible()
    console.log(`[ai] applied: ${applied}`)

    // ── put the fixture back, so seeding stays stable for every other spec
    await page.locator(`[data-asset-id="${FIXTURE}"]`).click({ button: "right" })
    await page.getByTestId("asset-menu-rename").click()
    const field = overview.locator("input").first()
    await field.fill(ORIGINAL_NAME)
    await overview.getByRole("button", { name: /save changes/i }).click()
    await page.reload()
    await page.goto("/videos")
    await page.locator(`[data-asset-id="${FIXTURE}"]`).click()
    await expect(page.getByTestId("asset-side-panel")).toContainText(ORIGINAL_NAME, {
      timeout: 20_000,
    })
    console.log("[ai] fixture name restored")
  })
})
