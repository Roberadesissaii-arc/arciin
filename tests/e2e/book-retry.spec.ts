import { expect, test } from "@playwright/test"

/**
 * The Retry button, driven the way a reader drives it.
 *
 * The orchestrator's repair path is covered by the stub suite, but a button is
 * a different thing from a function: it can be wired to the wrong action, be
 * offered for the wrong chapter, or not appear at all. Only the browser can
 * show that pressing *Retry Chapter N* reaches the code that writes chapter N.
 *
 * The failure is forced at the network layer rather than by asking a provider
 * to misbehave — deliberately breaking a real call costs tokens and teaches
 * nothing a 503 does not. Everything after the failure is a real generation.
 *
 * Cost: the plan turn, then chapter 2 once. Chapter 3 is only observed
 * *starting*, because that is the whole claim — that a successful retry hands
 * back to the automatic loop — and waiting for it to finish would buy no extra
 * certainty.
 */

/**
 * Opt-in. This spec spends real tokens against a real provider, so it must
 * never run as a side effect of `pnpm test:e2e`.
 */
const BOOK_E2E = process.env.E2E_BOOK === "1"

const BRIEF =
  "Write a short 3-chapter mystery about an archivist who finds a room that is not on any floor plan."

const RUN_TIMEOUT = 30 * 60 * 1000

type BookProject = {
  conversationId: string
  title: string
  status: string
  written: number
  attempts: number
  lastError?: string
  chapters: { number: number }[]
  manuscript: string
}

const READ_PROJECT = `(() => {
  try {
    const raw = window.localStorage.getItem("arciin:book-projects.v2")
    if (!raw) return null
    const all = JSON.parse(raw)
    if (!Array.isArray(all) || all.length === 0) return null
    return all.sort((a, b) => b.updatedAt - a.updatedAt)[0]
  } catch { return null }
})()`

test.describe("the Retry control", () => {
  test.skip(!BOOK_E2E, "set E2E_BOOK=1 to run the real-model book suite")

  test.describe.configure({ mode: "serial", timeout: RUN_TIMEOUT })

  test("a failed chapter stops the run, and Retry writes it exactly once", async ({ page }) => {
    const bookLog: string[] = []
    page.on("console", (msg) => {
      if (msg.text().startsWith("[book]")) bookLog.push(msg.text())
    })
    await page.addInitScript(() => {
      window.localStorage.setItem("arciin:book-debug", "1")
    })

    const read = async () => (await page.evaluate(READ_PROJECT)) as BookProject | null

    async function waitFor(
      predicate: (p: BookProject) => boolean,
      ms: number,
      what: string,
    ): Promise<BookProject> {
      const deadline = Date.now() + ms
      for (;;) {
        const p = await read()
        if (p && predicate(p)) return p
        if (Date.now() > deadline) {
          throw new Error(
            `timed out waiting for ${what}; last=${JSON.stringify({
              status: p?.status,
              written: p?.written,
              attempts: p?.attempts,
              lastError: p?.lastError,
            })}\n${bookLog.slice(-30).join("\n")}`,
          )
        }
        // Background generation is invisible to the idle watcher, which counts
        // only user input. Without this a long poll signs the tab out.
        await page.mouse.move(Math.round(Math.random() * 40) + 10, 12)
        await page.waitForTimeout(1500)
      }
    }

    /**
     * Fail every chapter request, but let the plan turn through.
     *
     * Registered before the book starts, because chapter 2 opens its stream the
     * instant the plan lands — a stub installed after that races the request it
     * is meant to intercept, which is exactly how an earlier shape of this test
     * missed the chapter it was aiming at.
     */
    let failChapters = true
    let streamCalls = 0
    // The chat stream is `<origin>/api/chat`, not `/chat/stream` — matched by
    // regex on the exact path so a sibling route like `/api/chat/conversations`
    // is never caught by it. An earlier glob matched nothing at all, and a
    // route that matches nothing fails open: the chapter simply succeeded and
    // the test sat waiting for a failure that was never going to come.
    await page.route(/\/api\/chat(?:\?|$)/, async (route) => {
      if (route.request().method() !== "POST") return route.continue()
      streamCalls += 1
      // The first call is the plan turn; it must succeed or there is no book.
      if (streamCalls === 1 || !failChapters) return route.continue()
      await route.fulfill({ status: 503, body: "stubbed provider outage" })
    })

    await page.goto("/chat")
    const composer = page.locator("textarea").first()
    await expect(composer).toBeVisible({ timeout: 30_000 })
    await composer.click()
    await composer.fill(`/book ${BRIEF}`)
    await page.keyboard.press("Escape")
    await composer.press("Enter")

    const planned = await waitFor((p) => p.written >= 1, 12 * 60 * 1000, "the plan and chapter 1")
    const total = planned.chapters.length
    console.log(`[retry] planned "${planned.title}" — ${total} chapters, ${planned.written} written`)
    expect(total, "the outline should have more than one chapter").toBeGreaterThan(1)

    // ── chapter 2 fails ─────────────────────────────────────────────────────
    const failed = await waitFor((p) => p.status === "failed", 5 * 60 * 1000, "chapter 2 to fail")
    const failedChapter = failed.written + 1
    console.log(`[retry] chapter ${failedChapter} failed: ${failed.lastError}`)
    expect(failedChapter, "the failure is on chapter 2").toBe(2)
    expect(failed.status).toBe("failed")

    // Chapter 1 is untouched, and nothing later was attempted.
    expect(failed.written, "chapter 1 survived the failure").toBe(planned.written)
    expect(
      [...failed.manuscript.matchAll(/^##\s*Chapter\s+(\d+)/gim)].map((m) => Number(m[1])),
      "the manuscript still holds exactly the chapters that were written",
    ).toEqual(Array.from({ length: planned.written }, (_, i) => i + 1))
    expect(
      bookLog.some((l) => l.includes("generation_started") && l.includes("chapter=3")),
      "chapter 3 must never start while chapter 2 is unwritten",
    ).toBe(false)
    console.log("[retry] chapter 3 never started")

    // It has to stay failed. A scheduler still ticking would keep burning
    // attempts rather than waiting for the reader.
    await page.waitForTimeout(15_000)
    expect((await read())!.status, "a failed run waits for the reader").toBe("failed")

    // ── the card offers Retry, for the right chapter ─────────────────────────
    const retryButton = page.getByRole("button", { name: /Retry Chapter/i }).first()
    await expect(retryButton, "the card must offer Retry").toBeVisible({ timeout: 30_000 })
    await expect(retryButton).toHaveText(new RegExp(`Retry Chapter ${failedChapter}`, "i"))
    console.log(`[retry] the card offers "Retry Chapter ${failedChapter}"`)

    // ── press it, for real ──────────────────────────────────────────────────
    failChapters = false
    const startsBefore = bookLog.filter((l) => l.includes("generation_started")).length
    await retryButton.click()

    const retried = await waitFor(
      (p) => p.written > failed.written,
      12 * 60 * 1000,
      "the retried chapter to land",
    )
    expect(retried.written, "Retry wrote exactly one chapter").toBe(failed.written + 1)
    console.log(`[retry] Retry wrote chapter ${retried.written}`)

    // ── exactly once, and nothing ran alongside it ──────────────────────────
    const appended = bookLog
      .filter((l) => l.includes("chapter_appended"))
      .map((l) => Number(/chapter=(\d+)/.exec(l)?.[1]))
    expect(
      appended.filter((n) => n === failedChapter).length,
      `chapter ${failedChapter} was appended more than once: ${appended.join(",")}`,
    ).toBe(1)
    expect(new Set(appended).size, `a chapter was appended twice: ${appended.join(",")}`).toBe(
      appended.length,
    )
    expect(
      [...retried.manuscript.matchAll(/^##\s*Chapter\s+(\d+)/gim)].map((m) => Number(m[1])),
      "every chapter appears once, in order",
    ).toEqual(Array.from({ length: retried.written }, (_, i) => i + 1))

    /**
     * One attempt at the retried chapter, not one generation overall.
     *
     * By the time chapter 2 has landed, chapter 3 has usually already opened
     * its own stream — that hand-back to the automatic loop is the point of the
     * test, so counting *all* starts since the click would fail on the very
     * behaviour being asserted. What must be exactly one is the number of times
     * the chapter that failed was started again.
     */
    const startedSinceClick = bookLog
      .filter((l) => l.includes("generation_started"))
      .slice(startsBefore)
      .map((l) => Number(/chapter=(\d+)/.exec(l)?.[1]))
    console.log(`[retry] generations started since the click: ${startedSinceClick.join(", ")}`)
    expect(
      startedSinceClick.filter((n) => n === failedChapter).length,
      `chapter ${failedChapter} was started ${startedSinceClick.filter((n) => n === failedChapter).length} times after Retry: ${startedSinceClick.join(",")}`,
    ).toBe(1)
    // Nothing ahead of itself: no chapter beyond the next one was ever started.
    expect(
      startedSinceClick.every((n) => n <= retried.written + 1),
      `a chapter ran ahead of the document: ${startedSinceClick.join(",")}`,
    ).toBe(true)
    // ── and the automatic loop takes over again ─────────────────────────────
    if (retried.written < total) {
      await waitFor(
        (p) => p.written > retried.written || p.status === "writing" || p.status === "completed",
        3 * 60 * 1000,
        "the run to carry on by itself",
      )
      await expect
        .poll(
          () =>
            bookLog.some(
              (l) =>
                l.includes("generation_started") && l.includes(`chapter=${retried.written + 1}`),
            ),
          {
            timeout: 3 * 60 * 1000,
            message: "a successful Retry must hand back to the automatic loop",
          },
        )
        .toBe(true)
      console.log(
        `[retry] chapter ${retried.written + 1} started automatically after the retry — no "continue" typed`,
      )
    }

    console.log("[retry] LOG_START\n" + bookLog.join("\n") + "\n[retry] LOG_END")
  })
})
