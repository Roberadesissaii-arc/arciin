import { expect, test, type Page } from "@playwright/test"

/**
 * Choosing where the separation runs, and being told how long it will take.
 *
 * Two properties matter here and neither is cosmetic.
 *
 * The choice is honoured. Separation is the half of a dub that reads the
 * original audio, so picking Local is usually a decision about where that audio
 * may go and picking Cloud is usually a decision about time. Substituting one
 * for the other — in either direction — undoes the reason someone chose.
 *
 * The estimate is real. It is arithmetic over persisted samples of the
 * separator's own chunk counter, so it survives a reload and cannot be a timer;
 * and it stays quiet until it has enough of them, because a figure derived from
 * one early sample is wrong by a factor of several.
 */

const FIXTURE = "e2e-video-transcript-fixture"
const RUNNING = "ar"

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

/** Pick from the app's own Select, which has no `selectOption`. */
async function choose(page: Page, testId: string, label: string | RegExp) {
  await panel(page).getByTestId(testId).click()
  const listbox = page.getByRole("listbox")
  await expect(listbox).toBeVisible()
  await listbox.getByRole("option", { name: label }).click()
  await expect(listbox).toBeHidden()
}

test.describe("processing location", () => {
  test.setTimeout(180_000)

  test("defaults to Auto and says which backend Auto picked", async ({ page }) => {
    await openDubbing(page)
    const processing = panel(page).getByTestId("dub-processing")
    await expect(processing).toBeVisible()
    await expect(processing.getByTestId("dub-processing-mode")).toContainText("Auto")

    // Auto has to say what it decided, or the reader cannot tell where their
    // audio went.
    const summary = processing.getByTestId("dub-processing-summary")
    await expect(summary).toContainText(/Local — this server/i)
    await expect(summary).toContainText(/chosen by Auto/i)
  })

  test("describes local processing without leaking hardware detail", async ({ page }) => {
    await openDubbing(page)
    await choose(page, "dub-processing-mode", /Local/)

    const summary = panel(page).getByTestId("dub-processing-summary")
    await expect(summary).toContainText(/Private processing/i)
    await expect(summary).toContainText(/No source audio is uploaded/i)
    await expect(summary).toContainText(/May be slow/i)

    // Instruction sets belong in technical details, not in the normal UI.
    const text = await summary.innerText()
    expect(text).not.toMatch(/AVX|onnx|Celeron|instruction set/i)
  })

  test("offers Cloud but refuses to pretend it works", async ({ page }) => {
    await openDubbing(page)
    await choose(page, "dub-processing-mode", /Cloud/)

    /**
     * Shown rather than hidden: hiding it suggests cloud separation does not
     * exist. Selectable-but-broken would be worse — it would promise something
     * that fails only after a long wait.
     */
    const notice = panel(page).getByTestId("dub-processing-cloud-unconfigured")
    await expect(notice).toBeVisible()
    await expect(notice).toContainText(/No cloud audio-separation provider configured/i)
    // And it states plainly that it will not quietly do the other thing.
    await expect(notice).toContainText(/will not fall back/i)
    await expect(notice.getByTestId("dub-processing-configure")).toBeVisible()
  })

  test("the server refuses an explicit Cloud request rather than running it here", async ({
    page,
  }) => {
    await openDubbing(page)

    /**
     * The refusal that matters most. Someone picks Cloud because their machine
     * is slow; running it locally anyway means discovering ninety minutes later
     * that nothing they asked for happened.
     */
    const result = await page.evaluate(async (id) => {
      const res = await fetch(`/api/assets/${id}/dubs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "es", separationMode: "cloud" }),
      })
      return { status: res.status, body: await res.text() }
    }, FIXTURE)

    expect(result.status).toBe(409)
    expect(result.body).toMatch(/cloud audio-separation provider/i)
  })

  test("remembers the choice across a reload", async ({ page }) => {
    await openDubbing(page)
    await choose(page, "dub-processing-mode", /Local/)

    // Persisted through the request that uses it, so nobody has to choose Local
    // every time.
    await page.evaluate(async (id) => {
      await fetch(`/api/assets/${id}/dubs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "es", separationMode: "local" }),
      })
    }, FIXTURE)

    await page.reload()
    await openDubbing(page)
    await expect(panel(page).getByTestId("dub-processing-mode")).toContainText(/Local/)

    // Put it back, so the rest of the suite sees the default it expects.
    await page.evaluate(async (id) => {
      await fetch(`/api/assets/${id}/dubs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "es", separationMode: "auto" }),
      })
    }, FIXTURE)
  })

  test("the disclosure names both providers separately", async ({ page }) => {
    await openDubbing(page)
    await panel(page).getByText("What leaves this server").click()

    const privacy = panel(page).getByTestId("dub-privacy")
    await expect(privacy).toBeVisible()

    /**
     * Never merged. "Local" must not read as "nothing leaves this server" when
     * the voice model receives translated text either way — that is the most
     * consequential vagueness available in this feature.
     */
    await expect(privacy.getByTestId("dub-privacy-separation")).toContainText(
      /stays on this server/i,
    )
    await expect(privacy.getByTestId("dub-privacy-voice")).toContainText(/translated text/i)
    await expect(privacy.getByTestId("dub-privacy-voice")).toContainText(/never uploaded/i)

    // Technical details may name the engine; the summary above must not.
    await expect(privacy).toContainText(/Demucs/)
    await expect(privacy).toContainText(/CPU/)
  })
})

test.describe("estimated time remaining", () => {
  test.setTimeout(180_000)

  test("shows a real estimate from the separator's own counter", async ({ page }) => {
    await openDubbing(page)

    /**
     * The fixture carries eight readings at the rate the 11:51 video actually
     * averaged, ending at 39 of 122. 83 chunks at ~45 seconds is a little over
     * an hour — so this asserts the shape and the order of magnitude, not a
     * figure that would be brittle to a second's drift.
     */
    const eta = panel(page).getByTestId("dub-progress-eta")
    await expect(eta).toBeVisible()
    await expect(eta).toHaveText(/^About 1 hr \d+ min remaining$/)
  })

  test("survives a reload, because it is computed from persisted samples", async ({ page }) => {
    await openDubbing(page)
    await expect(panel(page).getByTestId("dub-progress-eta")).toHaveText(/remaining/)

    await page.reload()
    await openDubbing(page)
    // A countdown held in component state would restart or vanish here.
    await expect(panel(page).getByTestId("dub-progress-eta")).toHaveText(
      /^About 1 hr \d+ min remaining$/,
    )
  })

  test("never reports a false precision", async ({ page }) => {
    await openDubbing(page)
    const text = await panel(page).getByTestId("dub-progress-eta").innerText()
    // "4812.393 seconds" claims an accuracy the measurement does not have.
    expect(text).not.toMatch(/\d+\.\d/)
    expect(text).not.toMatch(/second/i)
  })

  test("says it is estimating rather than guessing early on", async ({ page }) => {
    // Too few readings to describe a rate: the only interval observed would
    // include model loading.
    await page.route(/\/api\/assets\/[^/]+\/dubs(\?|$)/, async (route) => {
      if (route.request().method() !== "GET") return route.fallback()
      const response = await route.fetch()
      const body = (await response.json()) as { data: { dubs: Record<string, unknown>[] } }
      body.data.dubs = body.data.dubs.map((dub) =>
        dub.language === RUNNING
          ? { ...dub, progressSamples: [{ at: Date.now() - 45_000, completed: 1, total: 122 }] }
          : dub,
      )
      return route.fulfill({
        status: response.status(),
        contentType: "application/json",
        body: JSON.stringify(body),
      })
    })

    await openDubbing(page)
    await expect(panel(page).getByTestId("dub-progress-eta")).toHaveText("Estimating time…")
  })

  test("the card hover carries the same estimate", async ({ page }) => {
    await page.goto("/videos")
    const card = page.locator(`[data-asset-id="${FIXTURE}"]`)
    await expect(card).toBeVisible({ timeout: 60_000 })
    await card.getByTestId("asset-ai-indicator").hover()

    const tip = page.getByRole("tooltip").first()
    await expect(tip).toBeVisible()
    // Same samples, same arithmetic: the two views must not disagree about one
    // job between polls.
    await expect(tip.getByTestId("asset-ai-indicator-eta").first()).toHaveText(
      /^About 1 hr \d+ min remaining$/,
    )
  })
})
