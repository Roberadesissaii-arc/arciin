import { expect, test, type Page } from "@playwright/test"

/**
 * Choosing how each speaker sounds.
 *
 * Two properties are worth a browser test here, and neither is visual.
 *
 * The first is that looking is free. Every control in this panel changes what
 * the *next* generation will ask for, and a design that fired a request per
 * dropdown would let someone run up a bill by browsing options. So the POST
 * count is asserted across a run that touches every field.
 *
 * The second is that the settings actually leave the browser. A panel of
 * controls wired to nothing looks identical to a working one — the dub comes
 * back either way, just ignoring what was asked for — so the request body is
 * inspected directly. It is intercepted rather than forwarded: proving the
 * wiring should not cost a synthesis run.
 */

const FIXTURE = "e2e-video-transcript-fixture"

const panel = (page: Page) => page.getByTestId("asset-side-panel")

async function openDubbing(page: Page) {
  await page.goto("/videos")
  const card = page.locator(`[data-asset-id="${FIXTURE}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click()
  await expect(panel(page)).toBeVisible({ timeout: 15_000 })
  await page.getByTestId("asset-panel-tab-ai").click()
  await panel(page).getByTestId("video-ai-tab-dubbing").click()
  await expect(panel(page).getByTestId("dub-voice-settings")).toBeVisible({ timeout: 20_000 })
}

/**
 * Catch the generate request and answer it ourselves.
 *
 * Returns the bodies that were sent, so a test can assert on what the browser
 * asked for without a voice model ever being called.
 */
function captureGenerate(page: Page) {
  const bodies: Record<string, unknown>[] = []
  void page.route(/\/api\/assets\/[^/]+\/dubs$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue()
    bodies.push(route.request().postDataJSON() as Record<string, unknown>)
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { dub: null } }),
    })
  })
  return bodies
}

test.describe("voice settings", () => {
  test.setTimeout(120_000)

  test("auto shows the recommendation and offers nothing to fiddle with", async ({ page }) => {
    await openDubbing(page)
    const settings = panel(page).getByTestId("dub-voice-settings")

    // Auto is the default, because most people want the recommendation.
    await expect(settings.getByTestId("voice-mode-auto")).toHaveAttribute("aria-pressed", "true")

    // A card per speaker the transcript actually named — no invented third.
    await expect(settings.getByTestId("voice-speaker-Speaker-1")).toBeVisible()
    await expect(settings.getByTestId("voice-speaker-Speaker-2")).toBeVisible()
    await expect(settings.getByTestId("voice-speaker-Speaker-3")).toHaveCount(0)

    // Nothing to adjust, so nothing is shown.
    await expect(settings.getByTestId("voice-presentation-Speaker-1")).toHaveCount(0)
    await expect(settings.getByTestId("voice-gemini-Speaker-1")).toHaveCount(0)

    /**
     * And it does not claim to know anything about the people speaking. These
     * fields describe what a voice sounds like; an audio track cannot tell you
     * someone's gender, age or nationality, so the panel never says it does.
     */
    const text = (await settings.innerText()).toLowerCase()
    for (const forbidden of ["male", "female", "gender", "years old", "nationality", "ethnic"]) {
      expect(text, `must not claim ${forbidden}`).not.toContain(forbidden)
    }
  })

  test("changing any setting costs nothing", async ({ page }) => {
    const sent = captureGenerate(page)
    await openDubbing(page)
    const settings = panel(page).getByTestId("dub-voice-settings")

    await settings.getByTestId("voice-mode-advanced").click()

    // Every control, including the ones that only appear once chosen.
    await settings.getByTestId("voice-presentation-Speaker-1").selectOption("feminine")
    await settings.getByTestId("voice-age-Speaker-1").selectOption("mature")
    await settings.getByTestId("voice-accent-Speaker-1").selectOption("custom")
    await settings.getByTestId("voice-accent-custom-Speaker-1").fill("Indian English")
    await settings.getByTestId("voice-emotion-Speaker-1").selectOption("custom")
    await settings.getByTestId("voice-emotion-custom-Speaker-1").fill("quietly furious")
    await settings.getByTestId("voice-gemini-Speaker-1").selectOption("Kore")
    await settings.getByTestId("voice-pitch-Speaker-1").selectOption("low")
    await settings.getByTestId("voice-energy-Speaker-1").selectOption("high")
    await settings.getByTestId("voice-texture-Speaker-1").selectOption("warm")
    await settings.getByTestId("voice-pace-Speaker-1").selectOption("slow")
    await settings.getByTestId("voice-notes-Speaker-1").fill("sound like it is late at night")
    await settings.getByTestId("voice-emotion-Speaker-2").selectOption("excited")

    await page.waitForTimeout(1500)
    expect(sent, "a dropdown is not a purchase").toHaveLength(0)

    // And the panel says so, so nobody has to guess.
    await expect(settings).toContainText("Changing these costs nothing")
  })

  test("the chosen settings are what gets sent", async ({ page }) => {
    const sent = captureGenerate(page)
    await openDubbing(page)
    const settings = panel(page).getByTestId("dub-voice-settings")

    await settings.getByTestId("voice-mode-advanced").click()
    await settings.getByTestId("voice-accent-Speaker-1").selectOption("custom")
    await settings.getByTestId("voice-accent-custom-Speaker-1").fill("Indian English")
    await settings.getByTestId("voice-emotion-Speaker-1").selectOption("custom")
    await settings.getByTestId("voice-emotion-custom-Speaker-1").fill("quietly furious")
    await settings.getByTestId("voice-gemini-Speaker-1").selectOption("Kore")
    await settings.getByTestId("voice-notes-Speaker-1").fill("late at night")
    await settings.getByTestId("voice-emotion-Speaker-2").selectOption("excited")
    await settings.getByTestId("voice-pace-Speaker-2").selectOption("fast")

    await panel(page).getByTestId("regenerate-dub").click()
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(1)

    const profiles = (sent[0].voiceProfiles ?? []) as Record<string, unknown>[]
    const first = profiles.find((p) => p.speakerId === "Speaker 1")
    const second = profiles.find((p) => p.speakerId === "Speaker 2")

    expect(first?.accent).toEqual({ kind: "custom", description: "Indian English" })
    expect(first?.emotion).toEqual({ kind: "custom", description: "quietly furious" })
    expect(first?.selectedGeminiVoice).toBe("Kore")
    expect(first?.directorNotes).toBe("late at night")

    // The two speakers are directed separately, not given one shared setting.
    expect(second?.emotion).toEqual({ kind: "preset", preset: "excited" })
    expect(second?.pace).toBe("fast")
    expect(second?.selectedGeminiVoice, "Speaker 2 was left on auto").toBeUndefined()
  })

  test("auto sends no overrides at all", async ({ page }) => {
    const sent = captureGenerate(page)
    await openDubbing(page)
    const settings = panel(page).getByTestId("dub-voice-settings")

    /**
     * Choosing settings and then returning to Auto must mean Auto. Sending the
     * abandoned overrides anyway would silently apply choices the reader backed
     * out of, and they would have no way to tell.
     */
    await settings.getByTestId("voice-mode-simple").click()
    await settings.getByTestId("voice-presentation-Speaker-1").selectOption("masculine")
    await settings.getByTestId("voice-mode-auto").click()

    await panel(page).getByTestId("regenerate-dub").click()
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(1)
    expect(sent[0].voiceProfiles, "auto means the server matches every speaker").toBeUndefined()
  })

  test("advanced offers the provider's real voices and nothing invented", async ({ page }) => {
    await openDubbing(page)
    const settings = panel(page).getByTestId("dub-voice-settings")
    await settings.getByTestId("voice-mode-advanced").click()

    const picker = settings.getByTestId("voice-gemini-Speaker-1")
    // Named voices the provider documents. A made-up name here would fail at
    // synthesis with an error no reader could act on.
    for (const voice of ["Kore", "Puck", "Charon", "Schedar"]) {
      await expect(picker.locator(`option[value="${voice}"]`)).toHaveCount(1)
    }
    // Auto stays available, and stays the default.
    await expect(picker).toHaveValue("")
    await expect(picker.locator('option[value=""]')).toContainText(/recommended/i)
  })

  test("the server refuses a voice the provider does not have", async ({ page }) => {
    await openDubbing(page)

    /**
     * The picker can only offer real voices, but the endpoint is reachable
     * without it. Validating at the boundary means a bad override fails here,
     * cheaply, instead of inside a job that has already paid for separation.
     */
    const result = await page.evaluate(async (id) => {
      const res = await fetch(`/api/assets/${id}/dubs`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: "es",
          voiceProfiles: [{ speakerId: "Speaker 1", selectedGeminiVoice: "NotARealVoice" }],
        }),
      })
      return res.status
    }, FIXTURE)

    expect(result).toBe(400)
  })
})
