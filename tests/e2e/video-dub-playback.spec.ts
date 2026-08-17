import { expect, test, type Page } from "@playwright/test"

/**
 * Playing a dubbed track, in the browser, for real.
 *
 * This is the acceptance test the whole dubbing feature rests on, and it exists
 * because everything cheaper than it can pass while the feature is broken. The
 * audio route returning 200 proves a file is servable, not that a browser
 * decoded it. A green unit test on the timing maths proves the numbers are
 * right, not that two media elements stay together. So every assertion here
 * reads the live state of the actual `<video>` and `<audio>` elements —
 * readyState, duration, currentTime, paused — rather than anything the app says
 * about itself.
 *
 * The property that matters most is that switching language is not a reload.
 * Someone four seconds into a video who chooses Spanish should hear Spanish
 * from four seconds, not be thrown back to the beginning; the dub therefore
 * plays as a second source over an untouched video element, and this test is
 * what stops that quietly regressing into a re-mount.
 *
 * The second property is that playback is free. Speech costs money to make, so
 * pressing play, switching language, or switching back must never reach the
 * generate endpoint — that is asserted across the entire run, not per step.
 *
 * The dub is seeded (see `scripts/e2e-seed.mjs`): a committed ten-second tone
 * that steps pitch once a second. Whether a voice model produces good speech is
 * a separate question, answered by running the pipeline against the provider.
 */

const FIXTURE = "e2e-video-transcript-fixture"
const DUB_LANGUAGE = "es"

/** The drift the player itself tolerates before correcting. */
const DRIFT_TOLERANCE = 0.25
/** What a switch may cost the playhead. Generous, and nowhere near a reset. */
const POSITION_TOLERANCE = 0.4

const panel = (page: Page) => page.getByTestId("asset-side-panel")
const dubTrack = (page: Page) => page.getByTestId("dub-audio-track")

/** Everything a live media element can tell us. */
type MediaState = {
  currentTime: number
  duration: number
  readyState: number
  paused: boolean
  muted: boolean
  src: string
  networkState: number
  error: string | null
}

async function stateOf(page: Page, testId: string): Promise<MediaState> {
  return page.evaluate((id) => {
    const el = document.querySelector<HTMLMediaElement>(`[data-testid="${id}"]`)
    if (!el) throw new Error(`no media element with test id ${id}`)
    return {
      currentTime: el.currentTime,
      duration: Number.isFinite(el.duration) ? el.duration : -1,
      readyState: el.readyState,
      paused: el.paused,
      muted: el.muted,
      src: el.currentSrc || el.src,
      networkState: el.networkState,
      error: el.error ? `code ${el.error.code}: ${el.error.message}` : null,
    }
  }, testId)
}

/**
 * Every request that would spend money on speech.
 *
 * Only the POST: reading the list and streaming the audio are free and expected.
 */
function watchGenerateCalls(page: Page): string[] {
  const spent: string[] = []
  page.on("request", (request) => {
    if (request.method() !== "POST") return
    if (/\/api\/assets\/[^/]+\/dubs$/.test(request.url())) spent.push(request.url())
  })
  return spent
}

async function openDubbing(page: Page) {
  await page.goto("/videos")
  const card = page.locator(`[data-asset-id="${FIXTURE}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click()
  await expect(panel(page)).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("asset-panel-tab-ai").click()
  await expect(panel(page).getByTestId("video-ai-nav")).toBeVisible({ timeout: 20_000 })
  await panel(page).getByTestId("video-ai-tab-dubbing").click()
  await expect(panel(page).getByTestId("dubbing-section")).toBeVisible({ timeout: 20_000 })
}

/** Waits for the browser to have actually decoded enough to play. */
async function waitForDecodable(page: Page, testId: string) {
  await expect
    .poll(async () => (await stateOf(page, testId)).readyState, {
      timeout: 30_000,
      message: `${testId} never became playable`,
    })
    // HAVE_CURRENT_DATA or better: metadata alone is not playback.
    .toBeGreaterThanOrEqual(2)
  const state = await stateOf(page, testId)
  expect(state.error, `${testId} decode error`).toBeNull()
}

/**
 * Play from the real control.
 *
 * A click rather than `video.play()`, because the gesture is what lets the page
 * start the second audio element at all — and because a test that bypasses the
 * button is not testing what a person does.
 */
async function pressPlay(page: Page) {
  const player = panel(page).getByTestId("video-edit-player")
  await player.hover()
  await player.getByTestId("video-play-toggle").click()
}

async function seekTo(page: Page, seconds: number) {
  await page.evaluate((target) => {
    const el = document.querySelector<HTMLVideoElement>('[data-testid="asset-video"]')
    if (el) el.currentTime = target
  }, seconds)
  await expect
    .poll(async () => Math.abs((await stateOf(page, "asset-video")).currentTime - seconds), {
      timeout: 10_000,
    })
    .toBeLessThan(0.35)
}

test.describe("dubbed audio plays in the browser", () => {
  test.setTimeout(180_000)

  test("switching language keeps the playhead and starts the dub there", async ({ page }) => {
    const spent = watchGenerateCalls(page)
    await openDubbing(page)

    // The seeded dub is ready, so nothing here needs generating.
    const useAudio = panel(page).getByTestId("use-dub-audio")
    await expect(useAudio).toBeVisible({ timeout: 20_000 })
    await expect(useAudio).toContainText(/Use Spanish audio/i)

    await waitForDecodable(page, "asset-video")
    const original = await stateOf(page, "asset-video")
    expect(original.duration).toBeGreaterThan(9)
    expect(original.muted, "the original plays its own sound").toBe(false)

    // Play, and prove the picture actually moved before touching anything.
    await pressPlay(page)
    await expect
      .poll(async () => (await stateOf(page, "asset-video")).currentTime, { timeout: 20_000 })
      .toBeGreaterThan(0.3)
    expect((await stateOf(page, "asset-video")).paused).toBe(false)

    await seekTo(page, 4)
    const beforeSwitch = await stateOf(page, "asset-video")

    // ── the switch ────────────────────────────────────────────────────────
    await useAudio.click()
    await expect(useAudio).toContainText(/Using this audio/i)

    await expect(dubTrack(page)).toHaveCount(1)
    await waitForDecodable(page, "dub-audio-track")

    const afterVideo = await stateOf(page, "asset-video")
    const afterDub = await stateOf(page, "dub-audio-track")

    /**
     * The whole point. A language switch that reset the playhead would send
     * someone four seconds in back to the start, which is what a re-mounted
     * video element does and why the dub is a separate element.
     */
    expect(
      Math.abs(afterVideo.currentTime - beforeSwitch.currentTime),
      `playhead moved on switch: ${beforeSwitch.currentTime} -> ${afterVideo.currentTime}`,
    ).toBeLessThan(POSITION_TOLERANCE + 1.5)
    expect(afterVideo.currentTime, "still around four seconds").toBeGreaterThan(3.4)

    // The dub is at the same place, not at zero.
    expect(
      Math.abs(afterDub.currentTime - afterVideo.currentTime),
      `dub started at ${afterDub.currentTime} for a video at ${afterVideo.currentTime}`,
    ).toBeLessThan(POSITION_TOLERANCE + 1.5)
    expect(afterDub.currentTime, "the dub did not restart from the beginning").toBeGreaterThan(3)

    // It is a real, decoded, ten-second track — not a 200 with an empty body.
    expect(afterDub.duration).toBeGreaterThan(9)
    expect(afterDub.readyState).toBeGreaterThanOrEqual(2)
    expect(afterDub.src).toContain(`/dubs/${DUB_LANGUAGE}/audio`)
    expect(afterDub.paused, "the dub plays because the video was playing").toBe(false)

    // And the original dialogue is not playing underneath the translated one.
    expect(afterVideo.muted, "original muted while a dub plays").toBe(true)

    expect(spent, "playback must never generate speech").toHaveLength(0)
  })

  test("play, pause and seek stay in step", async ({ page }) => {
    const spent = watchGenerateCalls(page)
    await openDubbing(page)
    await waitForDecodable(page, "asset-video")

    await pressPlay(page)
    await expect
      .poll(async () => (await stateOf(page, "asset-video")).currentTime, { timeout: 20_000 })
      .toBeGreaterThan(0.3)

    await panel(page).getByTestId("use-dub-audio").click()
    await waitForDecodable(page, "dub-audio-track")

    // ── they advance together ─────────────────────────────────────────────
    const first = await stateOf(page, "dub-audio-track")
    await page.waitForTimeout(1500)
    const second = await stateOf(page, "dub-audio-track")
    expect(second.currentTime, "the dub is actually advancing").toBeGreaterThan(
      first.currentTime + 0.5,
    )

    const bothPlaying = await Promise.all([
      stateOf(page, "asset-video"),
      stateOf(page, "dub-audio-track"),
    ])
    expect(
      Math.abs(bothPlaying[0].currentTime - bothPlaying[1].currentTime),
      "drift while playing",
    ).toBeLessThanOrEqual(DRIFT_TOLERANCE + 0.2)

    // ── pause stops both ──────────────────────────────────────────────────
    await pressPlay(page)
    await expect
      .poll(async () => (await stateOf(page, "dub-audio-track")).paused, { timeout: 10_000 })
      .toBe(true)
    const pausedVideo = await stateOf(page, "asset-video")
    expect(pausedVideo.paused).toBe(true)

    // Paused means paused: neither element creeps forward.
    const settled = await stateOf(page, "dub-audio-track")
    await page.waitForTimeout(1000)
    const stillSettled = await stateOf(page, "dub-audio-track")
    expect(Math.abs(stillSettled.currentTime - settled.currentTime)).toBeLessThan(0.05)

    // ── seeking carries the dub with it ───────────────────────────────────
    await seekTo(page, 7)
    await expect
      .poll(async () => (await stateOf(page, "dub-audio-track")).currentTime, { timeout: 10_000 })
      .toBeGreaterThan(6.5)
    const afterSeek = await Promise.all([
      stateOf(page, "asset-video"),
      stateOf(page, "dub-audio-track"),
    ])
    expect(Math.abs(afterSeek[0].currentTime - afterSeek[1].currentTime)).toBeLessThan(
      POSITION_TOLERANCE,
    )

    expect(spent, "playing, pausing and seeking are all free").toHaveLength(0)
  })

  test("switching back to the original keeps the position and restores its sound", async ({
    page,
  }) => {
    const spent = watchGenerateCalls(page)
    await openDubbing(page)
    await waitForDecodable(page, "asset-video")

    await pressPlay(page)
    const toggle = panel(page).getByTestId("use-dub-audio")
    await toggle.click()
    await waitForDecodable(page, "dub-audio-track")
    await seekTo(page, 6)

    const before = await stateOf(page, "asset-video")
    await toggle.click()
    await expect(toggle).toContainText(/Use Spanish audio/i)
    // The element goes away, so nothing keeps decoding in the background.
    await expect(dubTrack(page)).toHaveCount(0)

    const after = await stateOf(page, "asset-video")
    expect(
      Math.abs(after.currentTime - before.currentTime),
      `position lost switching back: ${before.currentTime} -> ${after.currentTime}`,
    ).toBeLessThan(POSITION_TOLERANCE + 1.5)
    expect(after.currentTime, "still around six seconds").toBeGreaterThan(5.4)

    // Its own dialogue is audible again.
    await expect
      .poll(async () => (await stateOf(page, "asset-video")).muted, { timeout: 10_000 })
      .toBe(false)

    expect(spent, "switching back generates nothing").toHaveLength(0)
  })

  test("the dubbed audio is served with range support, so seeking is not a re-download", async ({
    page,
  }) => {
    await openDubbing(page)

    /**
     * A seek in a ten-second file is cheap either way, but the same route serves
     * a feature-length dub. Without range support the browser refetches from
     * zero on every seek, which is the difference between a scrub and a stall.
     */
    const response = await page.request.get(`/api/assets/${FIXTURE}/dubs/${DUB_LANGUAGE}/audio`, {
      headers: { Range: "bytes=1000-1999" },
    })
    expect(response.status()).toBe(206)
    expect(response.headers()["content-range"]).toMatch(/^bytes 1000-1999\//)
    expect((await response.body()).byteLength).toBe(1000)
  })
})
