import { readFileSync } from "node:fs"

import { expect, test, type Browser, type Page } from "@playwright/test"

/**
 * What a second computer *sees*, without spending a book.
 *
 * The expensive cross-device spec proves the property that costs money — that
 * an observer never generates. This one proves the property the reader
 * complained about — that a book running elsewhere is actually visible — and it
 * does so in seconds, so it can run on every change instead of once a release.
 *
 * The run is seeded through the real endpoint from Browser A, then asserted in
 * Browser B: a separate context with its own cookies and therefore its own
 * session id, which is exactly what the executor lease keys on. Nothing here is
 * faked in the browser; B genuinely learns about the run from the server.
 */

const TITLE = "The Bell Under Wintermere"
const TOTAL = 10

const chatRow = (page: Page) => page.getByRole("link", { name: /AI Chat/i }).first()

/**
 * A conversation with the opening turn in it.
 *
 * The message is not decoration. Chat renders the template picker instead of
 * the message list while a conversation is empty, and the progress card lives
 * in the message list — so a book "conversation" with no messages is a fixture
 * no reader would ever have, and it hid the card behind a welcome screen.
 */
async function createConversation(page: Page): Promise<string> {
  return page.evaluate(async (title) => {
    const res = await fetch("/api/chat/conversations", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
    if (!res.ok) throw new Error(`create conversation failed: ${res.status}`)
    const id = (await res.json()).data.id as string

    const saved = await fetch("/api/chat/conversations/messages", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: id,
        messages: [
          { role: "user", content: `/book ${title}` },
          { role: "assistant", content: "Planning the book." },
        ],
      }),
    })
    if (!saved.ok) throw new Error(`save messages failed: ${saved.status}`)
    return id
  }, TITLE)
}

/** Publish a run from this browser, claiming the lease for its session. */
async function publish(
  page: Page,
  conversationId: string,
  body: Record<string, unknown>,
): Promise<number> {
  return page.evaluate(
    async ({ conversationId, body }) => {
      const res = await fetch(`/api/conversations/${conversationId}/book-run`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      return res.status
    },
    { conversationId, body },
  )
}

const WRITING = {
  title: TITLE,
  status: "WRITING",
  totalChapters: TOTAL,
  writtenChapters: 3,
  currentChapter: 4,
  currentChapterTitle: "The Bell in the Lake",
  manuscript: [
    `# ${TITLE}`,
    "",
    "## Chapter 1: The Keeper",
    "",
    "Wintermere kept its own hours.",
    "",
    "## Chapter 2: Low Water",
    "",
    "The lake went down a foot that spring.",
    "",
    "## Chapter 3: The Second Lamp",
    "",
    "There was a room above the room.",
  ].join("\n"),
}

/**
 * Keep A's lease alive for the whole test, the way its heartbeat does.
 *
 * Discrete refreshes between steps were not enough: the lease lives 45 seconds
 * and a first-compile navigation in the dev server can outlast that, so the run
 * kept lapsing to INTERRUPTED and B was correctly — but unhelpfully — shown a
 * paused book with a Resume button instead of a live one.
 */
async function startHeartbeat(page: Page, conversationId: string, body: Record<string, unknown>) {
  await page.evaluate(
    ({ conversationId, body }) => {
      const w = window as unknown as { __hb?: number }
      if (w.__hb) window.clearInterval(w.__hb)
      const beat = () =>
        fetch(`/api/conversations/${conversationId}/book-run`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).catch(() => {})
      void beat()
      w.__hb = window.setInterval(beat, 10_000)
    },
    { conversationId, body },
  )
}

async function stopHeartbeat(page: Page) {
  await page
    .evaluate(() => {
      const w = window as unknown as { __hb?: number }
      if (w.__hb) window.clearInterval(w.__hb)
      w.__hb = undefined
    })
    .catch(() => {})
}

/** Settle everything so a later test's "quiet sidebar" assertion holds. */
async function settleAllRuns(page: Page) {
  await page.evaluate(async () => {
    const res = await fetch("/api/book-runs", { credentials: "include" })
    if (!res.ok) return
    const runs = (await res.json()).data.runs as { conversationId: string; title: string }[]
    await Promise.all(
      runs.map((r) =>
        fetch(`/api/conversations/${r.conversationId}/book-run`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: r.title, status: "COMPLETED" }),
        }),
      ),
    )
  })
}

/**
 * A second computer — which means a second **login**, not a second context.
 *
 * Reusing the saved storage state looked like a different machine and was not:
 * it copies the same session cookie, so the server saw one session and happily
 * reported the observer as the executor. The lease keys on the auth session,
 * which is the right granularity — two computers are two sessions — so B has to
 * sign in for itself to get one.
 */
async function secondComputer(browser: Browser) {
  const password = readFileSync("/tmp/arciin-e2e-pw", "utf8").trim()
  /**
   * `storageState: undefined` is load-bearing.
   *
   * A plain `newContext()` picked up the project's saved session, so `/login`
   * redirected straight to the dashboard, the email field never appeared, and
   * the "second computer" was A wearing a different hat — which is why the
   * server cheerfully reported the observer as the executor.
   */
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

  return { context, page }
}

test.describe("a book running on another computer is visible here", () => {
  test.describe.configure({ mode: "serial" })
  // Generous, because B signs in for real and the dev server compiles each
  // route the first time it is asked for.
  test.setTimeout(300_000)

  test("shows in the sidebar, History, the progress card and the Canvas", async ({
    page: pageA,
    browser,
  }) => {
    await pageA.goto("/files")
    await expect(chatRow(pageA)).toBeVisible({ timeout: 60_000 })
    await settleAllRuns(pageA)

    /**
     * B signs in **before** the run exists.
     *
     * The lease lives 45 seconds, and a fresh login plus a first-compile
     * navigation comfortably outlasts that — so seeding first meant the run had
     * already lapsed to INTERRUPTED by the time B looked, and nothing was
     * spinning. Getting B ready first, then keeping the lease warm the way A's
     * heartbeat does, is what a real pair of computers looks like.
     */
    const { context, page: pageB } = await secondComputer(browser)
    try {
      await pageB.goto("/files")
      await expect(chatRow(pageB)).toBeVisible({ timeout: 60_000 })

      // ── A starts (and owns) the run ─────────────────────────────────────
      const conversationId = await createConversation(pageA)
      expect(await publish(pageA, conversationId, WRITING)).toBe(200)
      // A is still writing, and keeps saying so.
      await startHeartbeat(pageA, conversationId, WRITING)

      await pageB.reload()
      await expect(chatRow(pageB)).toBeVisible({ timeout: 60_000 })

      // B is not the executor: its own session never claimed the run.
      const seen = await pageB.evaluate(async (id) => {
        const res = await fetch("/api/book-runs", { credentials: "include" })
        const runs = (await res.json()).data.runs as {
          conversationId: string
          isExecutor: boolean
          executedElsewhere: boolean
          status: string
        }[]
        return runs.find((r) => r.conversationId === id)
      }, conversationId)
      expect(seen, "B sees the run").toBeTruthy()
      expect(seen!.isExecutor, "B does not own it").toBe(false)
      expect(seen!.executedElsewhere, "B knows another computer is writing").toBe(true)
      // 1 — the sidebar indicator
      const spinner = pageB.getByTestId("ai-task-spinner").first()
      await expect(spinner, "the AI Chat row spins on B").toBeVisible({ timeout: 20_000 })
      // 2 — hover explains it
      await spinner.hover()
      const popover = pageB.getByTestId("ai-task-popover")
      await expect(popover).toBeVisible({ timeout: 10_000 })
      await expect(popover).toContainText(TITLE)
      await expect(popover).toContainText("Writing Chapter 4 of 10")
      await expect(popover).toContainText("3 of 10 chapters")
      await pageB.mouse.move(600, 400)
      // 3 — History shows the live book on its row
      await pageB.goto(`/chat?c=${conversationId}`)
      // History is a panel the reader opens from the header chip, and loading a
      // conversation closes it again — so open it after the deep link settles.
      await expect(pageB.getByTestId("book-progress-card")).toBeVisible({ timeout: 60_000 })
      // The chip's accessible name comes from its label, not its title attribute.
      await pageB.getByRole("button", { name: /^history$/i }).first().click()
      const historyRow = pageB.locator(`[data-conversation-id="${conversationId}"]`).first()
      await expect(historyRow, "the History row exists on B").toHaveCount(1, { timeout: 60_000 })
      await expect(historyRow, "History reports the live phase").toContainText(
        "Writing Chapter 4 of 10",
      )
      // Two, and both are meant: the row's icon becomes a spinner, and the
      // status line carries its own.
      await expect(
        historyRow.locator(".animate-spin").first(),
        "and spins while it runs",
      ).toBeVisible()
      // 4 — the progress card, honest about who is writing
      const card = pageB.getByTestId("book-progress-card")
      await expect(card).toBeVisible({ timeout: 60_000 })
      await expect(card).toContainText(TITLE)
      await expect(
        pageB.getByTestId("book-observer-badge"),
        "B is told another computer is writing",
      ).toBeVisible()
      // B holds no claim, so it is not offered a control it cannot honour.
      await expect(card.getByRole("button", { name: /pause|stopping/i })).toHaveCount(0)
      // 5 — the Canvas has the chapters A already wrote
      await pageB.getByRole("button", { name: /open manuscript/i }).first().click()
      const canvas = pageB.locator(".book-document:visible").first()
      await expect(canvas).toBeVisible({ timeout: 30_000 })
      await expect(canvas.locator(".book-chapter")).toHaveCount(3)

      // ── A finishes; B follows without being touched ───────────────────────
      await stopHeartbeat(pageA)
      expect(
        await publish(pageA, conversationId, {
          title: TITLE,
          status: "COMPLETED",
          totalChapters: TOTAL,
          writtenChapters: TOTAL,
          currentChapter: TOTAL,
        }),
      ).toBe(200)

      await expect(pageB.getByTestId("ai-task-spinner"), "the spinner clears on B").toHaveCount(0, {
        timeout: 60_000,
      })
    } finally {
      await stopHeartbeat(pageA)
      await settleAllRuns(pageA).catch(() => {})
      await context.close()
    }
  })

  test("an observer is refused the lease rather than allowed to write", async ({
    page: pageA,
    browser,
  }) => {
    await pageA.goto("/files")
    await expect(chatRow(pageA)).toBeVisible({ timeout: 60_000 })
    await settleAllRuns(pageA)

    const conversationId = await createConversation(pageA)
    expect(await publish(pageA, conversationId, WRITING)).toBe(200)

    const { context, page: pageB } = await secondComputer(browser)
    try {
      await pageB.goto("/files")
      await expect(chatRow(pageB)).toBeVisible({ timeout: 60_000 })

      // This is the write the orchestrator attempts before generating. Refused
      // means no duplicate paid model call.
      const status = await publish(pageB, conversationId, {
        title: TITLE,
        status: "THINKING",
        currentChapter: 4,
      })
      expect(status, "B must not be allowed to claim a live run").toBe(409)

      // And A's state is untouched by the attempt.
      const after = await pageA.evaluate(async (id) => {
        const res = await fetch(`/api/conversations/${id}/book-run`, { credentials: "include" })
        return (await res.json()).data.run as { status: string; writtenChapters: number }
      }, conversationId)
      expect(after.status).toBe("WRITING")
      expect(after.writtenChapters).toBe(3)
    } finally {
      await settleAllRuns(pageA).catch(() => {})
      await context.close()
    }
  })

  test("a lapsed lease reads as interrupted, not as still writing", async ({ page }) => {
    await page.goto("/files")
    await expect(chatRow(page)).toBeVisible({ timeout: 60_000 })
    await settleAllRuns(page)

    const conversationId = await createConversation(page)
    expect(await publish(page, conversationId, WRITING)).toBe(200)

    // Simulate the executor vanishing: PAUSED releases the lease, and a run
    // left in an active status with no live lease is what a closed browser
    // leaves behind. Reported as INTERRUPTED so nobody is shown "Writing
    // Chapter 4…" for a computer that is gone.
    const paused = await publish(page, conversationId, {
      title: TITLE,
      status: "PAUSED",
      totalChapters: TOTAL,
      writtenChapters: 3,
      currentChapter: 4,
    })
    expect(paused).toBe(200)

    const run = await page.evaluate(async (id) => {
      const res = await fetch(`/api/conversations/${id}/book-run`, { credentials: "include" })
      return (await res.json()).data.run as { status: string; executedElsewhere: boolean }
    }, conversationId)
    expect(run.status).toBe("PAUSED")
    expect(run.executedElsewhere, "a settled run belongs to no session").toBe(false)

    // Nothing is spinning for a book that is not being written.
    await page.reload()
    await expect(chatRow(page)).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId("ai-task-spinner")).toHaveCount(0)

    await settleAllRuns(page)
  })
})
