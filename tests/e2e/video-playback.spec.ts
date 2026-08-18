import { expect, test, type Page } from "@playwright/test"

/**
 * The video, playing.
 *
 * Everything else in the video suite is about what surrounds the picture —
 * transcripts, translations, titles — and each of those asserts a *seek*,
 * because seeking is how a transcript proves it is wired to the player. None of
 * them asserts that the thing plays at all, or that the bytes arrive the way a
 * `<video>` element needs them to.
 *
 * That left two properties with no test of their own. This is that test.
 *
 * **Playing.** Not "the button toggles an icon" — the playhead has to actually
 * advance, and it has to actually stop. A player that renders a pause icon
 * while the media sits still is exactly the bug a screenshot check misses.
 *
 * **Range requests.** A `<video>` seeks by asking for a byte range, and a
 * server that answers 200 with the whole file makes every seek a re-download of
 * the entire video. On a self-hosted box serving its owner's media over a home
 * connection that is the difference between usable and not. It is asserted
 * against the real download route rather than through the element, because the
 * element would happily hide a 200 behind a working-looking seek.
 *
 * Source media only. One element, one file, its own sound.
 */

const FIXTURE = "e2e-video-transcript-fixture"

const panel = (page: Page) => page.getByTestId("asset-side-panel")

/** The player as an ordinary reader reaches it: click the card, look at it. */
async function openPlayer(page: Page) {
  await page.goto("/videos")
  const card = page.locator(`[data-asset-id="${FIXTURE}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click()
  await expect(panel(page)).toBeVisible({ timeout: 15_000 })

  const video = panel(page).locator("video").first()
  await expect(video).toBeVisible({ timeout: 20_000 })

  /**
   * Wait for the media itself, not for the element.
   *
   * `readyState >= 2` is HAVE_CURRENT_DATA: metadata parsed and a frame
   * decoded. Pressing play before that is a race the test would lose
   * intermittently and blame on the product.
   */
  await expect
    .poll(
      () =>
        video.evaluate((el) => ({
          ready: (el as HTMLVideoElement).readyState,
          duration: (el as HTMLVideoElement).duration,
        })),
      { timeout: 30_000, message: "the video never loaded enough to play" },
    )
    .toMatchObject({ ready: expect.any(Number) })

  await expect
    .poll(() => video.evaluate((el) => (el as HTMLVideoElement).readyState), {
      timeout: 30_000,
    })
    .toBeGreaterThanOrEqual(2)

  return video
}

test.describe("normal source video playback", () => {
  test.setTimeout(120_000)

  test("plays, advances the playhead, and stops when paused", async ({ page }) => {
    const video = await openPlayer(page)

    // It has real media behind it, not a broken source.
    const duration = await video.evaluate((el) => (el as HTMLVideoElement).duration)
    expect(duration, "the fixture is ten seconds of real video").toBeGreaterThan(1)

    await panel(page).getByTestId("video-play-toggle").click()

    /**
     * Playing means moving. Polled rather than slept: the assertion is "the
     * playhead advanced", and waiting for that to be true is both faster and
     * more honest than waiting a fixed two seconds and hoping.
     */
    await expect
      .poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime), {
        timeout: 15_000,
        message: "the playhead never advanced after pressing play",
      })
      .toBeGreaterThan(0.2)

    await expect(video).toHaveJSProperty("paused", false)

    // And pausing stops it.
    await panel(page).getByTestId("video-play-toggle").click()
    await expect(video).toHaveJSProperty("paused", true)

    const atPause = await video.evaluate((el) => (el as HTMLVideoElement).currentTime)
    await expect
      .poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime), {
        timeout: 3_000,
      })
      .toBeLessThan(atPause + 0.35)
  })

  test("seeks to a position and stays there", async ({ page }) => {
    const video = await openPlayer(page)

    // Driven through the element rather than the scrubber: this is about the
    // media honouring a seek, not about pointer maths on a slider.
    await video.evaluate((el) => {
      ;(el as HTMLVideoElement).currentTime = 4
    })

    await expect
      .poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime), {
        timeout: 15_000,
        message: "the video did not seek",
      })
      .toBeGreaterThan(3.5)

    // Still there a moment later: a seek that silently rewinds is a seek that
    // did not happen.
    await expect(video).toHaveJSProperty("paused", true)
    await expect
      .poll(() => video.evaluate((el) => (el as HTMLVideoElement).currentTime), {
        timeout: 3_000,
      })
      .toBeGreaterThan(3.5)
  })
})

test.describe("source media is served for seeking", () => {
  test.setTimeout(120_000)

  test("answers a byte range with 206 and the range it sent", async ({ page }) => {
    /**
     * The property a `<video>` depends on and no UI assertion can see.
     *
     * Without range support every seek re-downloads the file from the start —
     * which on a self-hosted instance serving its owner's own media is the
     * difference between a usable player and an unusable one. Asserted against
     * the real route, with the session the browser already holds.
     */
    await page.goto("/videos")
    await expect(page.locator(`[data-asset-id="${FIXTURE}"]`)).toBeVisible({ timeout: 60_000 })

    const result = await page.evaluate(async (id) => {
      const res = await fetch(`/api/assets/${id}/download?inline=1`, {
        credentials: "include",
        headers: { Range: "bytes=0-1023" },
      })
      const body = await res.arrayBuffer()
      return {
        status: res.status,
        contentRange: res.headers.get("content-range"),
        acceptRanges: res.headers.get("accept-ranges"),
        contentLength: res.headers.get("content-length"),
        bytes: body.byteLength,
      }
    }, FIXTURE)

    expect(result.status, "a range request must be answered as partial content").toBe(206)
    expect(result.contentRange, "the response must say which bytes it is").toMatch(
      /^bytes 0-1023\/\d+$/,
    )
    expect(result.acceptRanges).toBe("bytes")
    // Exactly the slice asked for — not the whole file with a 206 stapled on.
    expect(result.bytes).toBe(1024)
    expect(result.contentLength).toBe("1024")
  })

  test("serves the whole file when no range is asked for", async ({ page }) => {
    // The other half of the contract: an ordinary request is still an ordinary
    // 200, and it still advertises that ranges are available.
    await page.goto("/videos")
    await expect(page.locator(`[data-asset-id="${FIXTURE}"]`)).toBeVisible({ timeout: 60_000 })

    const result = await page.evaluate(async (id) => {
      const res = await fetch(`/api/assets/${id}/download?inline=1`, { credentials: "include" })
      const body = await res.arrayBuffer()
      return {
        status: res.status,
        acceptRanges: res.headers.get("accept-ranges"),
        type: res.headers.get("content-type"),
        bytes: body.byteLength,
      }
    }, FIXTURE)

    expect(result.status).toBe(200)
    expect(result.acceptRanges, "a player has to be told seeking is possible").toBe("bytes")
    expect(result.type).toContain("video/")
    expect(result.bytes, "the committed fixture is 228 KB").toBeGreaterThan(100_000)
  })
})
