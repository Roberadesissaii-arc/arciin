import { expect, test } from "@playwright/test"

/**
 * The acceptance test the book feature never had.
 *
 * Everything else about `/book` is covered by stub-driven unit tests, and all
 * of it passed while the real feature stopped after chapter one — twice, for
 * two different reasons, because the seams that broke were the ones a stub
 * replaces: the transport's lifetime, the route's lifetime, and the model's
 * actual output. So this one drives the real browser, the real API and a real
 * model, and asserts the things a reader would notice.
 *
 * It is slow and it costs tokens. That is the point; it is the only test here
 * that can fail the way production failed.
 */

const BRIEF =
  "Write a short 3-chapter mystery about a university student who discovers a locked room underneath the campus library."

/** Three real chapters, each up to the provider's 600-second ceiling. */
const RUN_TIMEOUT = 35 * 60 * 1000

type BookProject = {
  conversationId: string
  title: string
  status: string
  written: number
  chapters: { number: number; title: string }[]
  manuscript: string
  memory: {
    chapterSummaries: { chapter: number; summary: string }[]
    characters: { name: string; note: string }[]
    facts: { name: string; note: string }[]
    threads: { id: string; description: string }[]
  }
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

test.describe("/book writes a whole book", () => {
  test.skip(!BOOK_E2E, "set E2E_BOOK=1 to run the real-model book suite")

  test.describe.configure({ mode: "serial", timeout: RUN_TIMEOUT })

  test("plans, writes three chapters unattended, and survives navigation", async ({ page }) => {
    const bookLog: string[] = []
    const pageErrors: string[] = []
    page.on("console", (msg) => {
      const text = msg.text()
      if (text.startsWith("[book]")) bookLog.push(text)
    })
    page.on("pageerror", (err) => pageErrors.push(String(err)))

    // The orchestrator's trace is compiled out of a production build unless
    // asked for. Without it a failure here would be as silent as the one this
    // test exists to catch.
    await page.addInitScript(() => {
      window.localStorage.setItem("arciin:book-debug", "1")
    })

    /** Poll the persisted project — the truth the UI is only a view of. */
    async function waitForProject(
      predicate: (p: BookProject) => boolean,
      ms: number,
      what: string,
    ): Promise<BookProject> {
      const deadline = Date.now() + ms
      for (;;) {
        const p = (await page.evaluate(READ_PROJECT)) as BookProject | null
        if (p && predicate(p)) return p
        if (Date.now() > deadline) {
          throw new Error(
            `timed out waiting for ${what}; last=${JSON.stringify({
              written: p?.written,
              status: p?.status,
              chapters: p?.chapters.length,
            })}\n${bookLog.slice(-40).join("\n")}`,
          )
        }
        // A book takes longer than the idle-logout timeout, and that watcher
        // counts only *user input* as activity — background generation is
        // invisible to it, so a poll-and-wait test gets signed out mid-run and
        // the failure looks like the book stopping. A reader navigating the app
        // while their book writes is producing these events anyway; sending
        // them keeps this test measuring the book rather than the timer.
        await page.mouse.move(Math.round(Math.random() * 40) + 10, 12)
        await page.waitForTimeout(2000)
      }
    }

    const waitForWritten = (atLeast: number, ms: number) =>
      waitForProject(
        (p) => p.written >= atLeast || p.status === "failed",
        ms,
        `chapter ${atLeast}`,
      )

    await page.goto("/chat")
    const composer = page.locator("textarea").first()
    await expect(composer).toBeVisible({ timeout: 30_000 })

    // ── the opening turn ────────────────────────────────────────────────────
    await composer.click()
    await composer.fill(`/book ${BRIEF}`)
    // The slash menu opens on "/" and would swallow Enter as a selection.
    await page.keyboard.press("Escape")
    await composer.press("Enter")

    // Planning is a single long call, and the model reasons out loud while it
    // runs. Waited on by the persisted project rather than by page copy: the
    // reasoning trace is thousands of words about writing a book, and a text
    // locator matched it long before the plan existed.
    const afterPlan = await waitForProject(
      (p) => p.chapters.length > 0 && p.written >= 1,
      12 * 60 * 1000,
      "the plan turn to produce a project",
    )
    await expect(page.getByTestId("book-progress-card")).toBeVisible({ timeout: 30_000 })
    console.log(
      `[acceptance] planned "${afterPlan!.title}" — ${afterPlan!.chapters.length} chapters, ${afterPlan!.written} written`,
    )
    expect(afterPlan!.chapters.length, "the outline should have chapters").toBeGreaterThan(0)
    expect(afterPlan!.written, "chapter 1 comes with the plan").toBeGreaterThanOrEqual(1)

    const totalChapters = afterPlan!.chapters.length


    // ── chapter 2 starts on its own ─────────────────────────────────────────
    // No "continue" is typed anywhere in this test. If chapter 2 needs one,
    // this is where the run stops.
    await expect
      .poll(
        async () => {
          const p = (await page.evaluate(READ_PROJECT)) as BookProject | null
          return p?.status
        },
        { timeout: 60_000, message: "the run should still be writing after chapter 1" },
      )
      .toMatch(/writing|stopping/)

    expect(
      bookLog.some((l) => l.includes("generation_started") && l.includes("chapter=2")),
      `chapter 2 should have started by itself\n${bookLog.join("\n")}`,
    ).toBe(true)
    console.log("[acceptance] chapter 2 started automatically")

    // ── leave Chat while chapter 2 is being written ─────────────────────────
    await page.getByRole("link", { name: "All Files", exact: true }).click()
    await page.waitForURL(/\/files/, { timeout: 30_000 })
    console.log("[acceptance] navigated to All Files mid-chapter")

    // The shell must say the work is still happening. The signal lives on the
    // AI Chat row itself: a spinner while work runs, detail on hover.
    const spinner = page.getByLabel(new RegExp(`${escapeRe(afterPlan!.title)} —`)).first()
    await expect(spinner, "the AI Chat row should spin while a book is writing").toBeVisible({
      timeout: 15_000,
    })
    await spinner.hover()
    const statusLine = await page
      .getByText(/Thinking · Chapter|Writing Chapter|Validating Chapter|Saving Chapter|Starting Chapter/i)
      .first()
      .textContent({ timeout: 15_000 })
    console.log(`[acceptance] hover card on /files says: ${statusLine}`)
    // Move the pointer away so the card closes before the next navigation.
    await page.mouse.move(600, 400)

    // ── and on to Settings, still away from Chat ────────────────────────────
    await page.getByRole("link", { name: "Settings", exact: true }).click()
    await page.waitForURL(/\/settings/, { timeout: 30_000 })
    console.log("[acceptance] navigated to Settings")

    // Chapter 2 must land with Chat unmounted. This is the assertion the
    // whole background-navigation change exists for.
    const afterTwo = await waitForWritten(2, 15 * 60 * 1000)
    expect(afterTwo.status, `chapter 2 failed: ${JSON.stringify(afterTwo)}`).not.toBe("failed")
    expect(afterTwo.written).toBeGreaterThanOrEqual(2)
    console.log(`[acceptance] chapter 2 landed while Chat was unmounted (written=${afterTwo.written})`)
    expect(page.url(), "still away from Chat").not.toContain("/chat")

    // ── click the spinning row to get back to the right conversation ────────
    // While work is running the AI Chat row points at that conversation, so the
    // obvious click lands on the book rather than on an empty new chat.
    const chatRow = page.getByRole("link", { name: /AI Chat/i }).first()
    const href = await chatRow.getAttribute("href")
    expect(href, "AI Chat should point at the running conversation").toContain("/chat?c=")
    await chatRow.click()
    await page.waitForURL(/\/chat/, { timeout: 30_000 })
    // Radix marks the rest of the page inert while the menu is open, which
    // hides every other control from the accessibility tree — `getByRole`
    // finds nothing at all until this closes.
    await page.keyboard.press("Escape")
    const liveConversationId = ((await page.evaluate(READ_PROJECT)) as BookProject).conversationId
    expect(liveConversationId, "the run must not be stuck on the placeholder key").not.toBe("__new__")
    expect(page.url(), "the task should open its own conversation").toContain(liveConversationId)
    console.log("[acceptance] AI Tasks opened the book's conversation")

    // ── the Canvas shows what was written while away ────────────────────────
    // The card only exists once the conversation's messages have loaded, and
    // the deep link resolves a beat after the URL changes.
    await expect(page.getByTestId("book-progress-card")).toBeVisible({ timeout: 60_000 })
    const openManuscript = page.getByRole("button", { name: /open manuscript/i }).first()
    await expect(openManuscript).toBeEnabled({ timeout: 30_000 })
    await openManuscript.click()
    // Book Mode sets chapter openings as a book does — "Chapter Two", not
    // "Chapter 2" — so the count of openings is what to assert, not the digit.
    // The panel and the mobile sheet are both mounted; only one is on screen.
    const canvas = page.locator(".book-document:visible").first()
    await expect(canvas).toBeVisible({ timeout: 30_000 })
    await expect
      .poll(async () => canvas.locator(".book-chapter").count(), {
        timeout: 30_000,
        message: "the Canvas should show the chapter written while Chat was unmounted",
      })
      .toBeGreaterThanOrEqual(2)
    await expect(canvas.locator(".book-chapter-number").nth(1)).toHaveText(/Chapter Two/i)
    console.log("[acceptance] Canvas restored with chapter 2, set as a book")

    // ── the rest of the book, still unattended ──────────────────────────────
    const done = await waitForWritten(totalChapters, 20 * 60 * 1000)
    expect(done.status, `the book should complete: ${done.status}`).toBe("completed")
    console.log(`[acceptance] completed — ${done.written}/${totalChapters} chapters`)

    // ── no chapter written twice, none missing ──────────────────────────────
    const headings = [...done.manuscript.matchAll(/^##\s*Chapter\s+(\d+)/gim)].map((m) =>
      Number(m[1]),
    )
    expect(headings, "chapters appear once each, in order").toEqual(
      Array.from({ length: totalChapters }, (_, i) => i + 1),
    )

    const startedChapters = bookLog
      .filter((l) => l.includes("generation_started"))
      .map((l) => Number(/chapter=(\d+)/.exec(l)?.[1]))
    const appended = bookLog
      .filter((l) => l.includes("chapter_appended"))
      .map((l) => Number(/chapter=(\d+)/.exec(l)?.[1]))
    expect(new Set(appended).size, "no chapter appended twice").toBe(appended.length)
    console.log(
      `[acceptance] generation_started for chapters ${startedChapters.join(", ")}; appended ${appended.join(", ")}`,
    )

    // ── Book Memory: kept internally, absent from the book ──────────────────
    for (const tag of [
      "[chapter-summary:",
      "[carry:",
      "[thread-open:",
      "[thread-resolved:",
      "[next:",
    ]) {
      expect(done.manuscript.includes(tag), `manuscript must not contain ${tag}`).toBe(false)
    }
    // The rendered page, after the last chapter has landed in it.
    await expect
      .poll(async () => canvas.locator(".book-chapter").count(), { timeout: 60_000 })
      .toBe(totalChapters)
    await expect(canvas.locator(".book-title")).toHaveCount(1)
    await expect(canvas.locator(".book-contents")).toHaveCount(1)
    await page.screenshot({ path: "test-results/book-mode-real.png" })
    const visible = await canvas.innerText()
    for (const tag of ["[chapter-summary:", "[carry:", "[thread-open:", "[thread-resolved:", "[next:"]) {
      expect(visible.includes(tag), `Canvas must not show ${tag}`).toBe(false)
    }
    // The transcript, not only the document. The manuscript was always clean;
    // the plan turn's reply was persisted raw, so a reader reopening the
    // conversation met the model's internal reports in their own chat.
    const transcript = await page.locator("main").first().innerText()
    for (const tag of ["[chapter-summary:", "[carry:", "[thread-open:", "[thread-resolved:", "[next:"]) {
      expect(transcript.includes(tag), `the chat transcript must not show ${tag}`).toBe(false)
    }

    const memorySize =
      done.memory.chapterSummaries.length +
      done.memory.characters.length +
      done.memory.facts.length +
      done.memory.threads.length
    console.log(
      `[acceptance] memory: ${done.memory.chapterSummaries.length} summaries, ` +
        `${done.memory.characters.length} characters, ${done.memory.facts.length} facts, ` +
        `${done.memory.threads.length} threads`,
    )
    expect(memorySize, "continuity data should have been captured internally").toBeGreaterThan(0)

    // ── the completed book stops counting as running ────────────────────────
    await page.getByRole("link", { name: "All Files", exact: true }).click()
    await page.waitForURL(/\/files/, { timeout: 30_000 })
    // A finished book stops spinning, and AI Chat goes back to a plain link.
    const stillSpinning = page.locator("nav .animate-spin")
    expect(await stillSpinning.count(), "a finished book is not a running task").toBe(0)
    const restedHref = await page.getByRole("link", { name: /AI Chat/i }).first().getAttribute("href")
    expect(restedHref, "AI Chat returns to its plain route once nothing is running").toBe("/chat")
    console.log("[acceptance] spinner cleared and AI Chat reset after completion")

    expect(pageErrors, `no page errors: ${pageErrors.join("\n")}`).toHaveLength(0)

    // Hand the manuscript and the trace to the report.
    await page.evaluate(
      ([ms, log]) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window as any).__bookResult = { manuscript: ms, log }
      },
      [done.manuscript, bookLog.join("\n")] as const,
    )
     
    console.log("[acceptance] BOOK_LOG_START\n" + bookLog.join("\n") + "\n[acceptance] BOOK_LOG_END")
     
    console.log(
      "[acceptance] MANUSCRIPT_START\n" + done.manuscript + "\n[acceptance] MANUSCRIPT_END",
    )
  })
})

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
