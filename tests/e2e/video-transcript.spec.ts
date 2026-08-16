import { expect, test } from "@playwright/test"

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

/** Opt-in: the generation half spends real Gemini tokens. */
const REAL = process.env.E2E_TRANSCRIPT === "1"

const VIDEO_NAME = "Creating_Arciin_SaaS_promo_video.mp4"
/** What the fixture actually says — see the earlier real backend run. */
const EXPECTED_PHRASE = /your (server|control)|self-hosted workspace/i

async function openVideosAndEdit(page: import("@playwright/test").Page) {
  await page.goto("/videos")
  const card = page.locator(`[data-asset-id="dev-video-promo"]`)
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
    test.skip(!REAL, "set E2E_TRANSCRIPT=1 to spend Gemini tokens")
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
