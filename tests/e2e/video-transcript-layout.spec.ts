import { expect, test, type Page } from "@playwright/test"

/**
 * The transcript's presentation, with none of its behaviour changed.
 *
 * The redesign moved four actions into a menu and rebuilt how segments look. The
 * risk in that is not that it looks wrong — it is that something people rely on
 * quietly stops being reachable. So this asserts both halves: that the clutter
 * is gone, and that every action it removed from the row still works from where
 * it went.
 */

const FIXTURE = "e2e-video-transcript-fixture"

const panel = (page: Page) => page.getByTestId("asset-side-panel")
const transcript = (page: Page) => panel(page).getByTestId("video-transcript")

async function openTranscript(page: Page) {
  await page.goto("/videos")
  const card = page.locator(`[data-asset-id="${FIXTURE}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click()
  await expect(panel(page)).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("asset-panel-tab-ai").click()
  await panel(page).getByTestId("video-ai-tab-transcript").click()
  await expect(transcript(page).getByTestId("video-transcript-segments")).toBeVisible({
    timeout: 20_000,
  })
}

test.describe("transcript actions", () => {
  test.setTimeout(180_000)

  test("shows two actions and a menu, not six equal buttons", async ({ page }) => {
    await openTranscript(page)

    // What people reach for while reading stays visible.
    await expect(transcript(page).getByTestId("transcript-copy")).toBeVisible()
    await expect(transcript(page).getByTestId("transcript-more")).toBeVisible()

    /**
     * The others are gone from the row. Six buttons of equal weight meant
     * nothing looked more important than anything else — and Regenerate, which
     * spends money and discards manual edits, sat beside Copy as a peer.
     */
    await expect(transcript(page).getByTestId("transcript-copy-times")).toHaveCount(0)
    await expect(transcript(page).getByTestId("transcript-download-txt")).toHaveCount(0)
    await expect(transcript(page).getByTestId("transcript-download-srt")).toHaveCount(0)
    await expect(transcript(page).getByTestId("regenerate-transcript")).toHaveCount(0)
  })

  test("every moved action is still reachable, and none of them is hidden", async ({ page }) => {
    await openTranscript(page)
    await transcript(page).getByTestId("transcript-more").click()

    const menu = page.getByRole("menu")
    await expect(menu).toBeVisible()
    // Reduced clutter must not mean removed functionality.
    for (const id of [
      "transcript-copy-times",
      "transcript-download-txt",
      "transcript-download-srt",
      "regenerate-transcript",
    ]) {
      await expect(menu.getByTestId(id)).toBeVisible()
    }
  })

  test("copy still copies", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
    await openTranscript(page)

    await transcript(page).getByTestId("transcript-copy").click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain("This is line 1 of the fixture.")
    // Plain copy carries no timecodes; that is what the menu entry is for.
    expect(copied).not.toMatch(/\[?00:0\d\]?\s/)
  })

  test("copy with timestamps still includes them", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
    await openTranscript(page)

    await transcript(page).getByTestId("transcript-more").click()
    await page.getByTestId("transcript-copy-times").click()

    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toMatch(/00:0\d/)
    expect(copied).toContain("This is line 1 of the fixture.")
  })

  test("the exports still download", async ({ page }) => {
    await openTranscript(page)

    for (const [id, extension] of [
      ["transcript-download-txt", "txt"],
      ["transcript-download-srt", "srt"],
    ] as const) {
      await transcript(page).getByTestId("transcript-more").click()
      const download = page.waitForEvent("download", { timeout: 20_000 })
      await page.getByTestId(id).click()
      const file = await download
      expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`))
    }
  })
})

test.describe("transcript reading", () => {
  test.setTimeout(180_000)

  test("a timestamp still seeks the video", async ({ page }) => {
    await openTranscript(page)

    const stamp = transcript(page).getByTestId("transcript-timestamp").nth(4)
    const target = Number(await stamp.getAttribute("data-start-ms"))
    await stamp.click()

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            document.querySelector<HTMLVideoElement>('[data-testid="asset-video"]')?.currentTime ??
            -1,
        ),
      )
      .toBeGreaterThan(target / 1000 - 0.6)
  })

  test("the timestamp reads as a control, not as a warning", async ({ page }) => {
    await openTranscript(page)
    const stamp = transcript(page).getByTestId("transcript-timestamp").first()

    /**
     * It used to be bare orange text, which on a page of grey reads as an error
     * rather than as something to press. A quiet pill says "interactive"
     * without saying "something went wrong".
     */
    const styles = await stamp.evaluate((el) => {
      const computed = getComputedStyle(el)
      return { background: computed.backgroundColor, radius: computed.borderRadius }
    })
    expect(styles.background).not.toBe("rgba(0, 0, 0, 0)")
    expect(parseFloat(styles.radius)).toBeGreaterThan(0)
  })

  test("search filters, counts, and highlights without asking a model", async ({ page }) => {
    const modelCalls: string[] = []
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/api\/assets\/[^/]+\/transcript/.test(request.url())) {
        modelCalls.push(request.url())
      }
    })

    await openTranscript(page)
    await transcript(page).getByTestId("transcript-search").fill("line 3")

    await expect(transcript(page).getByTestId("transcript-match-count")).toHaveText("1 match")
    await expect(transcript(page).locator("mark")).toHaveCount(1)
    await expect(transcript(page).getByTestId("video-transcript-segments")).toContainText("line 3")

    // Search is a filter over what is already here.
    expect(modelCalls, "search must never be another model call").toHaveLength(0)
  })

  test("the playing segment is marked without shouting", async ({ page }) => {
    await openTranscript(page)

    const active = transcript(page).getByTestId("transcript-active-segment")
    await expect(active).toHaveCount(1)
    // An accent edge rather than a colour change on every word: following along
    // must not turn the page into a flashing list.
    const border = await active.evaluate((el) => getComputedStyle(el).borderLeftWidth)
    expect(parseFloat(border)).toBeGreaterThan(0)
  })

  test("a translation uses the same layout as the original", async ({ page }) => {
    await openTranscript(page)

    await transcript(page).getByTestId("transcript-language-switcher").click()
    await page.getByTestId("transcript-language-option-es").click()
    await expect(transcript(page).getByTestId("video-transcript-segments")).toContainText(
      "Esta es la linea",
      { timeout: 20_000 },
    )

    /**
     * The same reading layout, not a second visual language. A translation is
     * the same document in another language and should not feel like a
     * different feature.
     */
    await expect(transcript(page).getByTestId("transcript-timestamp").first()).toBeVisible()
    await expect(transcript(page).getByTestId("transcript-copy")).toBeVisible()
    await expect(transcript(page).getByTestId("transcript-more")).toBeVisible()
    await expect(transcript(page).getByTestId("transcript-search")).toBeVisible()
  })
})
