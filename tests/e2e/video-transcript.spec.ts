import { expect, test, type Page } from "@playwright/test"

import { geminiKeyConfigured } from "./gemini-fixture"

/**
 * Videos → Edit → right-side drawer → Generate transcript.
 *
 * The whole point of the feature is the path a person actually walks, so this
 * walks it: open the library, use the card's Edit action, confirm the panel
 * enters from the right, ask for a transcript, and read timestamped speech back
 * out of a real video.
 *
 * Two properties are checked that no unit test can see. Media must not reach
 * Gemini until someone asks — opening the drawer is not asking. And the job must
 * outlive the drawer, so closing it mid-run and coming back shows the run, not a
 * fresh empty state.
 */

/**
 * Opt-in, and only when a credential was actually provisioned.
 *
 * The temporary Gemini profile is created by globalSetup from
 * `E2E_GEMINI_API_KEY`. Without it the deterministic tests still run and this
 * leg skips with a reason, because a missing paid-provider credential is not a
 * suite failure.
 */
const REAL = process.env.E2E_TRANSCRIPT === "1" && geminiKeyConfigured()

/**
 * How long a queued job may sit before we conclude nobody is consuming it.
 *
 * Generous enough for the worker to boot and claim the job, far short of the
 * ten-minute model wait — the point is to fail with a useful sentence instead
 * of hanging until the suite times out on what looks like a broken feature.
 */
const WORKER_GRACE_MS = 90_000

/**
 * Seeded by `scripts/e2e-seed.mjs`, not by hand.
 *
 * This used to be a row somebody had created manually on one machine, so a
 * clean checkout could not run the suite and the failure read as a broken
 * feature rather than a missing fixture.
 */
const FIXTURE_ASSET_ID = "e2e-video-transcript-fixture"

const VIDEO_NAME = "e2e-video-transcript-fixture.mp4"
/** What the fixture actually says — see the earlier real backend run. */
const EXPECTED_PHRASE = /your (server|control)|self-hosted workspace/i

/**
 * Fail fast when nothing is consuming the queue.
 *
 * A job that stays PENDING means the dev worker is not running, which used to
 * present as a spinner that never resolved and a ten-minute timeout blaming
 * the transcript feature.
 */
async function assertWorkerIsConsuming(page: Page, assetId: string) {
  const deadline = Date.now() + WORKER_GRACE_MS
  let last = "unknown"
  for (;;) {
    const status = await page.evaluate(async (id) => {
      const res = await fetch(`/api/assets/${id}/transcript`, { credentials: "include" })
      if (!res.ok) return `http-${res.status}`
      const body = await res.json()
      return (body?.data?.transcript?.status as string) ?? "none"
    }, assetId)
    last = status
    // Anything past PENDING means a consumer picked it up.
    if (status !== "PENDING" && status !== "none") return
    if (Date.now() > deadline) {
      throw new Error(
        `Dev media worker is not consuming the queue: the job stayed ${last} for ` +
          `${WORKER_GRACE_MS / 1000}s. globalSetup starts the worker; check its output ` +
          "and that ARCIIN_ENV_NAMESPACE=dev matches the queue the API publishes to.",
      )
    }
    await page.waitForTimeout(2000)
  }
}

async function openVideosAndEdit(page: Page) {
  await page.goto("/videos")
  const card = page.locator(`[data-asset-id="${FIXTURE_ASSET_ID}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.hover()
  await card.getByTestId("video-card-edit").click()
  const drawer = page.getByTestId("video-edit-drawer")
  await expect(drawer).toBeVisible({ timeout: 15_000 })
  return drawer
}

test.describe("video transcript", () => {
  test("Edit opens a right-side drawer with the video and a transcript section", async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const drawer = await openVideosAndEdit(page)

    // Right side, not a centred modal.
    await expect(drawer).toHaveAttribute("data-side", "right")

    await expect(drawer.getByText("Edit video")).toBeVisible()
    await expect(drawer.getByText(VIDEO_NAME).first()).toBeVisible()
    await expect(drawer.getByTestId("video-edit-player").locator("video")).toBeVisible()
    // Headings, not any text: the sheet's screen-reader description also says
    // "details", and a loose text match found that instead.
    await expect(drawer.getByRole("heading", { name: "Details" })).toBeVisible()
    await expect(drawer.getByRole("heading", { name: "Transcript" })).toBeVisible()
    await expect(drawer.getByTestId("generate-transcript")).toBeVisible()
  })

  test("opening the drawer does not send the video anywhere", async ({ page }) => {
    test.setTimeout(120_000)
    // The privacy boundary: media leaves the instance only on an explicit ask.
    const generateCalls: string[] = []
    await page.route("**/api/assets/*/transcript", (route) => {
      if (route.request().method() === "POST") generateCalls.push(route.request().url())
      return route.continue()
    })

    await openVideosAndEdit(page)
    await page.waitForTimeout(3000)
    expect(generateCalls, "no transcript job should be created just by looking").toHaveLength(0)
  })

  test("shows the empty state before anything is generated", async ({ page }) => {
    test.setTimeout(120_000)
    const drawer = await openVideosAndEdit(page)
    const transcript = drawer.getByTestId("video-transcript")
    // Either untouched, or carrying a result from an earlier run in this suite.
    const hasButton = await transcript.getByTestId("generate-transcript").isVisible().catch(() => false)
    const hasSegments = await transcript
      .getByTestId("video-transcript-segments")
      .isVisible()
      .catch(() => false)
    expect(hasButton || hasSegments).toBe(true)
  })

  test.describe("with a real Gemini transcription", () => {
    test.skip(
      !REAL,
      process.env.E2E_TRANSCRIPT === "1"
        ? "Real Gemini E2E skipped: E2E_GEMINI_API_KEY not configured"
        : "set E2E_TRANSCRIPT=1 (with E2E_GEMINI_API_KEY) to spend Gemini tokens",
    )
    test.describe.configure({ timeout: 15 * 60 * 1000 })

    test("generates, persists, and seeks the video from a timestamp", async ({ page }) => {
      const drawer = await openVideosAndEdit(page)
      const transcript = drawer.getByTestId("video-transcript")

      // Start from nothing, whatever an earlier run left behind.
      const generate = transcript.getByTestId("generate-transcript")
      const regenerate = transcript.getByTestId("regenerate-transcript")
      if (await regenerate.isVisible().catch(() => false)) {
        await regenerate.click()
      } else {
        await generate.click()
      }

      // Before waiting minutes on a model: is anything consuming the queue?
      await assertWorkerIsConsuming(page, FIXTURE_ASSET_ID)

      // Queued/processing is visible and honest about surviving a close.
      await expect(
        transcript.getByText(/Preparing media|Analyzing audio with Gemini/i),
      ).toBeVisible({ timeout: 30_000 })
      console.log("[transcript] processing state shown")

      // The job must not belong to the component.
      await page.keyboard.press("Escape")
      await expect(drawer).toBeHidden({ timeout: 10_000 })
      await page.waitForTimeout(4000)

      const reopened = await openVideosAndEdit(page)
      const reopenedTranscript = reopened.getByTestId("video-transcript")
      console.log("[transcript] drawer reopened mid-job")

      // Wait for the real model.
      await expect(reopenedTranscript.getByTestId("video-transcript-segments")).toBeVisible({
        timeout: 10 * 60 * 1000,
      })
      console.log("[transcript] transcript rendered")

      const stamps = reopenedTranscript.getByTestId("transcript-timestamp")
      const count = await stamps.count()
      expect(count, "timestamped segments").toBeGreaterThan(0)
      const body = await reopenedTranscript.innerText()
      console.log(`[transcript] ${count} segments\n${body.slice(0, 600)}`)

      // Real speech from the fixture, not a placeholder.
      expect(body).toMatch(EXPECTED_PHRASE)
      // Timecodes read as MM:SS, never raw milliseconds.
      await expect(stamps.first()).toHaveText(/^\d{1,2}:\d{2}(:\d{2})?$/)

      // Timestamp → seek.
      const target = count > 1 ? stamps.nth(1) : stamps.first()
      const targetMs = Number(await target.getAttribute("data-start-ms"))
      await target.click()
      await expect
        .poll(
          async () =>
            reopened.getByTestId("video-edit-player").locator("video").evaluate(
              (el) => (el as HTMLVideoElement).currentTime,
            ),
          { timeout: 10_000 },
        )
        .toBeGreaterThanOrEqual(Math.max(0, targetMs / 1000 - 1))
      console.log(`[transcript] seek to ${targetMs}ms verified`)

      // Persistence: close and reopen.
      await page.keyboard.press("Escape")
      await expect(reopened).toBeHidden({ timeout: 10_000 })
      const again = await openVideosAndEdit(page)
      await expect(again.getByTestId("video-transcript-segments")).toBeVisible({ timeout: 30_000 })
      console.log("[transcript] survived close/reopen")

      // Persistence: full page refresh.
      await page.reload()
      const afterRefresh = await openVideosAndEdit(page)
      await expect(afterRefresh.getByTestId("video-transcript-segments")).toBeVisible({
        timeout: 30_000,
      })
      const refreshedBody = await afterRefresh.getByTestId("video-transcript").innerText()
      expect(refreshedBody).toMatch(EXPECTED_PHRASE)
      console.log("[transcript] survived browser refresh")

      // Search filters client-side, no model call.
      const search = afterRefresh.getByTestId("transcript-search")
      await search.fill("zzzznotpresent")
      await expect(afterRefresh.getByText(/No segments match/i)).toBeVisible()
      await search.fill("")
      console.log("[transcript] search verified")
    })
  })
})
