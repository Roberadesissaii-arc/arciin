import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test"

/**
 * Two computers, one account, one real book.
 *
 * The definitive acceptance run: a real model writes three chapters in Browser
 * A while Browser B — a genuinely separate session — watches. B must see the
 * same run in the sidebar, in History, on the progress card and in the Canvas,
 * and must never generate a chapter of its own.
 *
 * The duplicate check is the expensive one to get wrong: two sessions each
 * concluding "chapter 2 is missing" means two paid model calls and two chapter
 * twos in someone's book. So this spec counts generation starts per chapter and
 * asserts exactly one each.
 */

const REAL = process.env.E2E_BOOK === "1"

const BRIEF =
  "Write a short 3-chapter science-fiction story about a researcher who discovers a signal beneath Mars."

/** Three real chapters, each up to the provider's 600-second ceiling. */
const RUN_TIMEOUT = 60 * 60 * 1000

const SESSION_COOKIE = process.env.SESSION_COOKIE_NAME ?? "arciin_session"

type RunView = {
  id: string
  conversationId: string
  title: string
  status: string
  writtenChapters: number
  totalChapters: number
  currentChapter: number
  isExecutor: boolean
  executedElsewhere: boolean
}

const ACTIVE = ["PLANNING", "THINKING", "WRITING", "VALIDATING", "SAVING"]

/** Read the server's view of the runs, as this browser's session sees it. */
async function serverRuns(page: Page): Promise<RunView[]> {
  return page.evaluate(async () => {
    const res = await fetch("/api/book-runs", { credentials: "include" })
    if (!res.ok) return []
    return (await res.json()).data.runs as RunView[]
  })
}

async function runFor(page: Page, conversationId: string): Promise<RunView | undefined> {
  return (await serverRuns(page)).find((r) => r.conversationId === conversationId)
}

/**
 * A short digest of the session cookie.
 *
 * Enough to prove two browsers hold different sessions without ever printing
 * the credential itself.
 */
async function sessionFingerprint(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find((c) => c.name === SESSION_COOKIE)
  if (!cookie?.value) return "none"
  return createHash("sha256").update(cookie.value).digest("hex").slice(0, 12)
}

/**
 * Poll while keeping the session alive.
 *
 * A book outlives the idle-logout timeout, and that watcher counts only user
 * input as activity. A test that merely waits gets signed out mid-run and the
 * failure looks like the book stopping — so nudge the mouse the way a reader
 * using the app during a long write would.
 */
async function pollAlive<T, U extends T>(
  page: Page,
  read: () => Promise<T>,
  done: (value: T) => value is U,
  ms: number,
  what: string,
): Promise<U>
async function pollAlive<T>(
  page: Page,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms: number,
  what: string,
): Promise<T>
async function pollAlive<T>(
  page: Page,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms: number,
  what: string,
): Promise<T> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}; last=${JSON.stringify(value)}`)
    }
    await page.mouse.move(Math.round(Math.random() * 40) + 10, 12)
    await page.waitForTimeout(2000)
  }
}

/**
 * A second computer — which means a second **login**, not a second context.
 *
 * `storageState: undefined` is load-bearing: a plain `newContext()` inherits the
 * project's saved session, so B would carry A's cookie, the server would see one
 * session, and the observer would be reported as the executor. The lease keys on
 * the auth session, which is the right granularity — two computers are two
 * sessions — so B signs in for itself.
 */
async function secondComputer(browser: Browser) {
  const password = readFileSync("/tmp/arciin-e2e-pw", "utf8").trim()
  const context = await browser.newContext({ storageState: undefined })
  await context.clearCookies()
  const page = await context.newPage()

  await page.goto("/login")
  const email = page.locator('input[type="email"]')
  await expect(email, "B must actually be signed out").toBeVisible({ timeout: 30_000 })
  await email.fill("e2e@arciin.invalid")
  await page.locator('input[type="password"]').first().fill(password)
  await page.getByRole("button", { name: /sign in|log in|continue/i }).first().click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 })

  await page.goto("/files")
  await expect(page.getByRole("link", { name: /AI Chat/i }).first()).toBeVisible({
    timeout: 60_000,
  })
  return { context, page }
}

/** `[book] generation_started chapter=2 operation=… attempt=1` */
function chaptersIn(lines: string[], event: string): number[] {
  return lines
    .filter((l) => l.includes(event))
    .map((l) => Number(/chapter=(\d+)/.exec(l)?.[1]))
    .filter((n) => Number.isFinite(n))
}

function countBy(numbers: number[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const n of numbers) counts.set(n, (counts.get(n) ?? 0) + 1)
  return counts
}

test.describe("a book running on another computer", () => {
  test.skip(!REAL, "set E2E_BOOK=1 to run the real-model cross-device suite")
  test.describe.configure({ mode: "serial", timeout: RUN_TIMEOUT })

  /**
   * Hoisted so the trace survives a failure.
   *
   * These counts are the whole point of the run and they used to be printed
   * only after the last assertion — so the one time an assertion failed, the
   * evidence about duplicate generation was thrown away with it.
   */
  let logA: string[] = []
  let logB: string[] = []

  test.afterEach(() => {
    const startsA = countBy(chaptersIn(logA, "generation_started"))
    const startsB = countBy(chaptersIn(logB, "generation_started"))
    const appendedA = chaptersIn(logA, "chapter_appended")
    for (const [chapter, count] of [...startsA.entries()].sort((a, b) => a[0] - b[0])) {
      console.log(`[cross] chapter ${chapter} generation_started on A: ${count}`)
    }
    console.log(`[cross] generation_started on B: ${chaptersIn(logB, "generation_started").length}`)
    console.log(`[cross] observer starts by chapter: ${JSON.stringify([...startsB])}`)
    console.log(`[cross] chapters appended on A: ${appendedA.join(", ") || "(none)"}`)
  })

  test("is visible, observable, and never generated twice", async ({
    page: pageA,
    context: contextA,
    browser,
  }) => {
    logA = []
    logB = []
    pageA.on("console", (m) => {
      if (m.text().startsWith("[book]")) logA.push(m.text())
    })

    await pageA.addInitScript(() => {
      window.localStorage.setItem("arciin:book-debug", "1")
      // Fall back to the instance default profile rather than whatever a
      // previous run happened to select. The dev default is the cloud provider;
      // the local Ollama host is far too slow to write a book.
      window.localStorage.removeItem("arciin:chat:selected-profile-id")
      window.localStorage.removeItem("arciin:chat:selected-model")
    })

    await pageA.goto("/chat")
    const composer = pageA.locator("textarea").first()
    await expect(composer).toBeVisible({ timeout: 30_000 })

    // Which model is actually about to be billed and timed.
    const modelChip = await pageA
      .locator("button", { hasText: /deepseek|llama|gemini|grok|gpt|qwen|granite/i })
      .first()
      .innerText()
      .catch(() => "(unknown)")
    console.log(`[cross] A composer model: ${modelChip.replace(/\n/g, " ")}`)
    expect(
      modelChip.toLowerCase(),
      "the local Ollama host cannot write a book; the run must use the cloud profile",
    ).not.toContain("llama3.2")

    /**
     * Runs from earlier specs live in the same dev database.
     *
     * An earlier version polled for "a run exists", matched a leftover from the
     * indicator spec and passed its opening assertions in 28 seconds without
     * ever writing a book. Only a conversation that did not exist before this
     * test counts.
     */
    const preexisting = new Set((await serverRuns(pageA)).map((r) => r.conversationId))

    // ── Browser A starts the book ─────────────────────────────────────────
    await composer.click()
    await composer.fill(`/book ${BRIEF}`)
    // The slash menu opens on "/" and would swallow Enter as a selection.
    await pageA.keyboard.press("Escape")
    await composer.press("Enter")

    // Planning is one long call; the model reasons out loud while it runs.
    const planned = await pollAlive(
      pageA,
      async () => (await serverRuns(pageA)).find((r) => !preexisting.has(r.conversationId)),
      (r): r is RunView => Boolean(r && r.totalChapters > 0),
      20 * 60 * 1000,
      "the plan to reach the server",
    )
    const conversationId = planned.conversationId
    console.log(
      `[cross] A planned "${planned.title}" — ${planned.totalChapters} chapters, ${planned.writtenChapters} written`,
    )
    expect(planned.isExecutor, "A owns the run it started").toBe(true)

    // Chapter 1 lands with the plan turn.
    const afterCh1 = await pollAlive(
      pageA,
      () => runFor(pageA, conversationId),
      (r) => Boolean(r && (r.writtenChapters >= 1 || !ACTIVE.includes(r.status))),
      25 * 60 * 1000,
      "chapter 1",
    )
    expect(afterCh1!.writtenChapters, "chapter 1 is written").toBeGreaterThanOrEqual(1)
    console.log(`[cross] A finished chapter 1 (${afterCh1!.writtenChapters}/${afterCh1!.totalChapters})`)

    // Chapter 2 must be genuinely in flight while B looks.
    const writingCh2 = await pollAlive(
      pageA,
      () => runFor(pageA, conversationId),
      (r) => Boolean(r && (r.currentChapter >= 2 || !ACTIVE.includes(r.status))),
      10 * 60 * 1000,
      "chapter 2 to start",
    )
    console.log(
      `[cross] A is on chapter ${writingCh2!.currentChapter}, status ${writingCh2!.status}`,
    )
    expect(writingCh2!.isExecutor, "A still holds the lease").toBe(true)

    // ── Browser B: a different computer, same account ─────────────────────
    const { context: contextB, page: pageB } = await secondComputer(browser)
    pageB.on("console", (m) => {
      if (m.text().startsWith("[book]")) logB.push(m.text())
    })

    // Proof the sessions really differ — not just two context objects.
    const fpA = await sessionFingerprint(contextA)
    const fpB = await sessionFingerprint(contextB)
    console.log(`[cross] session A=${fpA} session B=${fpB} same=${fpA === fpB}`)
    expect(fpA, "A holds a session").not.toBe("none")
    expect(fpB, "B holds a session").not.toBe("none")
    expect(fpB, "B must not share A's session cookie").not.toBe(fpA)

    // B sees the run without ever having started one.
    const seen = await runFor(pageB, conversationId)
    expect(seen, "B sees the same run").toBeTruthy()
    expect(seen!.isExecutor, "B must not own the run").toBe(false)
    expect(seen!.executedElsewhere, "B knows someone else is writing").toBe(true)
    console.log(
      `[cross] B observes: ${seen!.title} — ${seen!.writtenChapters}/${seen!.totalChapters}, status ${seen!.status}, chapter ${seen!.currentChapter}`,
    )

    // ── 1. the sidebar indicator ──────────────────────────────────────────
    const spinnerB = pageB.getByTestId("ai-task-spinner").first()
    await expect(spinnerB, "B shows the running indicator").toBeVisible({ timeout: 30_000 })

    // ── 2. hover shows real progress ──────────────────────────────────────
    await spinnerB.hover()
    const popover = pageB.getByTestId("ai-task-popover")
    await expect(popover).toBeVisible({ timeout: 10_000 })
    const popoverText = (await popover.innerText()).replace(/\n/g, " | ")
    console.log(`[cross] B hover: ${popoverText}`)
    expect(popoverText, "the book title").toContain(planned.title)
    expect(popoverText, "chapter progress").toMatch(/\d+ of \d+ chapters/)
    await pageB.mouse.move(600, 400)

    // ── 3. the conversation, its card and its Canvas ──────────────────────
    await pageB.goto(`/chat?c=${conversationId}`)
    const card = pageB.getByTestId("book-progress-card")
    await expect(card).toBeVisible({ timeout: 60_000 })
    console.log(`[cross] B card: ${(await card.innerText()).replace(/\n/g, " | ")}`)
    await expect(card).toContainText(planned.title)
    await expect(
      pageB.getByTestId("book-observer-badge"),
      "B is told another computer is writing",
    ).toBeVisible()
    await expect(
      card.getByRole("button", { name: /pause|stopping/i }),
      "B is not offered a control it cannot honour",
    ).toHaveCount(0)

    // ── 4. History, on its existing row ───────────────────────────────────
    // A panel the reader opens from the header chip; its accessible name is
    // its label, not its title attribute.
    await pageB.getByRole("button", { name: /^history$/i }).first().click()
    const historyRow = pageB.locator(`[data-conversation-id="${conversationId}"]`).first()
    await expect(historyRow, "the History row exists on B").toHaveCount(1, { timeout: 60_000 })
    console.log(`[cross] B history: ${(await historyRow.innerText()).replace(/\n/g, " | ")}`)
    /**
     * The row is a *conversation*, so it keeps the conversation's title.
     *
     * An earlier version asserted the book title here and failed a run that was
     * behaving perfectly: History names the chat ("Researcher Discovers Signal
     * Beneath Mars") and lends the preview line to the book's live phase. That
     * status line is the thing this test actually cares about.
     */
    await expect(historyRow, "History reports the live phase").toContainText(
      /(Planning|Thinking|Writing|Checking|Saving) .*Chapter \d+/,
    )
    await expect(historyRow.locator(".animate-spin").first(), "and it spins").toBeVisible()

    // ── 5. the Canvas holds the manuscript A already wrote ────────────────
    await pageB.getByRole("button", { name: /open manuscript/i }).first().click()
    const canvasB = pageB.locator(".book-document:visible").first()
    await expect(canvasB).toBeVisible({ timeout: 30_000 })
    const chaptersOnB = await pollAlive(
      pageB,
      () => canvasB.locator(".book-chapter").count(),
      (n) => n >= 1,
      60_000,
      "chapter 1 in B's Canvas",
    )
    console.log(`[cross] B canvas shows ${chaptersOnB} chapter(s)`)

    // ── 6. B must not generate ────────────────────────────────────────────
    // The exact write the orchestrator attempts before spending anything.
    const claim = await pageB.evaluate(async (id) => {
      const res = await fetch(`/api/conversations/${id}/book-run`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "THINKING", title: "observer attempt" }),
      })
      return res.status
    }, conversationId)
    console.log(`[cross] B claim attempt → ${claim}`)
    expect(claim, "an observer's claim is refused while A holds the lease").toBe(409)

    // ── 7. live sync: B follows A through the rest of the book ────────────
    const sequence: string[] = []
    const note = (r: RunView | undefined) => {
      if (!r) return
      const line = `${r.writtenChapters} / ${r.totalChapters} · ${r.status} · chapter ${r.currentChapter}`
      if (sequence[sequence.length - 1] !== line) {
        sequence.push(line)
        console.log(`[cross] B sees: ${line}`)
      }
    }
    note(seen)

    const total = planned.totalChapters
    await pollAlive(
      pageB,
      async () => {
        const r = await runFor(pageB, conversationId)
        note(r)
        return r
      },
      (r) => Boolean(r && (r.writtenChapters >= 2 || !ACTIVE.includes(r.status))),
      30 * 60 * 1000,
      "B to see chapter 2 land",
    )

    // ── 8. completion ─────────────────────────────────────────────────────
    const done = await pollAlive(
      pageB,
      async () => {
        const r = await runFor(pageB, conversationId)
        note(r)
        return r
      },
      (r) => Boolean(r && !ACTIVE.includes(r.status)),
      30 * 60 * 1000,
      "the book to finish",
    )
    console.log(`[cross] B observed sequence:\n  ${sequence.join("\n  ")}`)
    expect(done!.status, "the book completed").toBe("COMPLETED")
    expect(done!.writtenChapters, "every chapter written").toBe(total)

    // The indicator goes quiet, and History drops its running styling.
    await expect(pageB.getByTestId("ai-task-spinner")).toHaveCount(0, { timeout: 90_000 })
    await expect(historyRow.locator(".animate-spin")).toHaveCount(0, { timeout: 60_000 })
    await expect(card).toContainText(/complete/i, { timeout: 60_000 })

    // The full manuscript, on the observer.
    const finalChapters = await pollAlive(
      pageB,
      () => canvasB.locator(".book-chapter").count(),
      (n) => n >= total,
      120_000,
      `all ${total} chapters in B's Canvas`,
    )
    console.log(`[cross] B canvas final: ${finalChapters} chapters`)

    // ── 9. exact generation counts ────────────────────────────────────────
    const startsA = countBy(chaptersIn(logA, "generation_started"))
    const startsB = countBy(chaptersIn(logB, "generation_started"))
    const appendedA = chaptersIn(logA, "chapter_appended")

    expect(startsB.size, "the observer must never generate").toBe(0)
    expect(logB.filter((l) => l.includes("generation_started")), "B started nothing").toHaveLength(0)

    // Chapters 2..N are the ones a second executor would duplicate. Chapter 1
    // is excluded only because a retry there is legitimate and unrelated.
    for (let chapter = 2; chapter <= total; chapter += 1) {
      expect(startsA.get(chapter) ?? 0, `chapter ${chapter} started exactly once`).toBe(1)
    }
    // Nothing was written to the manuscript twice.
    expect(new Set(appendedA).size, "no chapter appended twice").toBe(appendedA.length)

    await contextB.close()
  })
})

test.describe("book run authorization", () => {
  test("another user's run is not readable by conversation id", async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto("/files")
    await expect(page.getByRole("link", { name: /AI Chat/i }).first()).toBeVisible({
      timeout: 60_000,
    })

    // A conversation id that is not this user's. The answer must be the same
    // as for one that does not exist — telling a caller which ids are real is
    // itself a leak.
    const status = await page.evaluate(async () => {
      const res = await fetch("/api/conversations/not-my-conversation/book-run", {
        credentials: "include",
      })
      return res.status
    })
    expect(status).toBe(404)

    const writeStatus = await page.evaluate(async () => {
      const res = await fetch("/api/conversations/not-my-conversation/book-run", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "WRITING", title: "Injected" }),
      })
      return res.status
    })
    expect(writeStatus).toBe(404)
  })
})
