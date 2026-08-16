import { expect, test } from "@playwright/test"

/**
 * The controls, driven the way a reader drives them.
 *
 * Pause, Resume, Retry and a browser reload are all covered by the stub suite,
 * but every one of them is a *button* in the end, and the stub suite cannot see
 * a button wired to the wrong action or a card that never offers Retry. This
 * clicks the real controls against a real model.
 *
 * One book covers the sequence a reader would actually hit: a browser reload
 * with a chapter genuinely in flight → the run comes back paused rather than
 * relaunching → Resume writes the chapter actually missing from the document →
 * the automatic loop carries it to the end → Book Mode is checked against the
 * result.
 *
 * Retry has its own spec, because forcing a failure has to happen before the
 * book starts. Pause is not squeezed in here either: with three chapters a
 * reload consumes the first opportunity, and pressing Pause during the last
 * chapter completes the book instead of pausing it — correctly, since there is
 * nothing left to hold back.
 */

const BRIEF =
  "Write a short 3-chapter mystery about a night porter who finds the same key in three different rooms."

const RUN_TIMEOUT = 40 * 60 * 1000

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

/**
 * Opt-in. This spec spends real tokens against a real provider, so it must
 * never run as a side effect of `pnpm test:e2e`.
 */
const BOOK_E2E = process.env.E2E_BOOK === "1"

test.describe("the book controls", () => {
  test.skip(!BOOK_E2E, "set E2E_BOOK=1 to run the real-model book suite")

  test.describe.configure({ mode: "serial", timeout: RUN_TIMEOUT })

  test("a reload mid-chapter recovers, and Resume writes the missing chapter", async ({ page }) => {
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
            })}\n${bookLog.slice(-25).join("\n")}`,
          )
        }
        // A book takes longer than the idle-logout timeout, and that watcher
        // counts only *user input* as activity — background generation is
        // invisible to it, so a poll-and-wait test gets signed out mid-run and
        // the failure looks like the book stopping. A reader navigating the app
        // while their book writes is producing these events anyway; sending
        // them keeps this test measuring the book rather than the timer.
        await page.mouse.move(Math.round(Math.random() * 40) + 10, 12)
        await page.waitForTimeout(1500)
      }
    }

    await page.goto("/chat")
    const composer = page.locator("textarea").first()
    await expect(composer).toBeVisible({ timeout: 30_000 })
    await composer.click()
    await composer.fill(`/book ${BRIEF}`)
    await page.keyboard.press("Escape")
    await composer.press("Enter")

    await expect(page.getByText(/Writing your book/i).first()).toBeVisible({
      timeout: 12 * 60 * 1000,
    })
    const planned = await waitFor((p) => p.written >= 1, 60_000, "chapter 1")
    const total = planned.chapters.length
    console.log(`[controls] planned "${planned.title}" — ${total} chapters`)

    // ── A real browser reload, with a chapter genuinely in flight ───────────
    // The case that matters: chapter 2 is being written when the page goes
    // away. The interrupted attempt may have finished server-side, so coming
    // back and relaunching it is exactly how a chapter gets written twice.
    await waitFor((p) => p.status === "writing", 60_000, "chapter 2 to be in flight")
    const beforeReload = (await read())!
    console.log(
      `[controls] reloading mid-chapter with ${beforeReload.written} written, status ${beforeReload.status}`,
    )
    await page.reload()
    await expect(page.locator("textarea").first()).toBeVisible({ timeout: 60_000 })

    const afterReload = await waitFor(
      (p) => p.status !== "writing",
      90_000,
      "recovery after the reload",
    )
    console.log(`[controls] after reload: status=${afterReload.status} written=${afterReload.written}`)
    expect(afterReload.status, "an interrupted run comes back paused, not writing").toBe("paused")
    expect(afterReload.written, "nothing already written was lost").toBe(beforeReload.written)
    expect(
      afterReload.manuscript.length,
      "the manuscript survived the reload",
    ).toBeGreaterThanOrEqual(beforeReload.manuscript.length)
    // Nothing was relaunched behind the reload.
    await page.waitForTimeout(15_000)
    expect((await read())!.status, "it stays paused rather than resuming itself").toBe("paused")
    expect((await read())!.written, "and writes nothing on its own").toBe(beforeReload.written)

    // The offer must name the chapter actually missing from the document.
    const nextAfterReload = afterReload.written + 1
    await expect(
      page.getByText(new RegExp(`Next: Chapter ${nextAfterReload}`, "i")).first(),
    ).toBeVisible({ timeout: 30_000 })
    console.log(`[controls] after reload the card offers Chapter ${nextAfterReload}`)

    // ── Resume, from the reloaded state ─────────────────────────────────────
    const beforeResume = afterReload.written
    await page.getByRole("button", { name: /^Resume/i }).first().click()
    const resumed = await waitFor(
      (p) => p.written > beforeResume || p.status === "failed",
      12 * 60 * 1000,
      "the chapter Resume was offered for",
    )
    expect(resumed.status).not.toBe("failed")
    expect(resumed.written, "Resume wrote the missing chapter").toBe(beforeResume + 1)
    console.log(`[controls] resumed after the reload and wrote chapter ${resumed.written}`)
    expect(
      [...resumed.manuscript.matchAll(/^##\s*Chapter\s+(\d+)/gim)].map((m) => Number(m[1])),
      "no chapter repeated across the reload",
    ).toEqual(Array.from({ length: resumed.written }, (_, i) => i + 1))

    // The forced-failure and Retry path lives in book-retry.spec.ts. It needs
    // the failure stubbed *before* the book starts — chapter 2 opens its stream
    // the instant the plan lands, so a route installed mid-run races the very
    // request it is meant to intercept, and the failure never happens.
    const finished = await waitFor(
      (p) => p.status === "completed" || p.status === "failed",
      20 * 60 * 1000,
      "the book to finish",
    )
    expect(finished.status).toBe("completed")
    expect(
      [...finished.manuscript.matchAll(/^##\s*Chapter\s+(\d+)/gim)].map((m) => Number(m[1])),
      "every chapter once, in order",
    ).toEqual(Array.from({ length: total }, (_, i) => i + 1))
    const appended = bookLog
      .filter((l) => l.includes("chapter_appended"))
      .map((l) => Number(/chapter=(\d+)/.exec(l)?.[1]))
    expect(new Set(appended).size, `no chapter appended twice: ${appended}`).toBe(appended.length)
    console.log(`[controls] finished — ${finished.written}/${total}, appended ${appended.join(", ")}`)

    // ── Book Mode, against the book that was actually written ───────────────
    // Not a fixture. The renderer's whole claim is that a real manuscript,
    // canonical markdown and all, reads as a book — so it is checked against
    // one, and the screenshot goes in the report.
    await page.getByRole("button", { name: /open manuscript/i }).first().click()
    // The panel and the mobile sheet are both mounted; only one is on screen.
    const book = page.locator(".book-document:visible").first()
    await expect(book).toBeVisible({ timeout: 30_000 })

    const finalProject = finished
    await expect(book.locator(".book-title")).toHaveCount(1)
    await expect(book.locator(".book-contents")).toHaveCount(1)
    const chapterOpenings = book.locator(".book-chapter")
    expect(
      await chapterOpenings.count(),
      "one chapter opening per written chapter",
    ).toBe(finalProject.written)
    // "Chapter One", not "Chapter 1" — set the way a book sets it.
    await expect(book.locator(".book-chapter-number").first()).toHaveText(/Chapter One/i)
    console.log(
      `[controls] Book Mode: title page, Contents and ${await chapterOpenings.count()} chapter openings`,
    )

    const rendered = await book.innerText()
    for (const tag of ["[chapter-summary:", "[carry:", "[thread-open:", "[thread-resolved:", "[next:"]) {
      expect(rendered.includes(tag), `Book Mode must not show ${tag}`).toBe(false)
    }
    // Workflow chatter is the other thing that must never reach the page.
    expect(rendered).not.toMatch(/writing in canvas|reasoning trace|tool_call/i)

    await page.screenshot({ path: "test-results/book-mode-page-1.png" })
    await book.locator(".book-chapter").nth(1).scrollIntoViewIfNeeded()
    await page.screenshot({ path: "test-results/book-mode-chapter-2.png" })
    if ((await chapterOpenings.count()) > 2) {
      await book.locator(".book-chapter").nth(2).scrollIntoViewIfNeeded()
      await page.screenshot({ path: "test-results/book-mode-chapter-3.png" })
    }
    const sceneBreaks = await book.locator(".book-scene-break").count()
    console.log(`[controls] scene breaks rendered: ${sceneBreaks}`)

    console.log("[controls] LOG_START\n" + bookLog.join("\n") + "\n[controls] LOG_END")
    console.log("[controls] MANUSCRIPT_START\n" + finalProject.manuscript + "\n[controls] MANUSCRIPT_END")
  })
})
