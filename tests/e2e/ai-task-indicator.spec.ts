import { expect, test, type Page } from "@playwright/test"

/**
 * The running-work indicator, without spending a book.
 *
 * What is being checked is the *shell*, not the orchestrator: while a book is
 * running the AI Chat row spins, hovering explains what it is doing, and
 * clicking lands in that conversation rather than a fresh chat.
 *
 * The run is seeded through the real book-run endpoint rather than pushed into
 * the browser's store. That costs nothing and reaches states a real run only
 * hits after many minutes — and, since the indicator now reads shared state
 * rather than this tab's, seeding the server is the only way to drive it at
 * all. It also means these tests exercise the same path a second computer
 * uses.
 */

type FakeRun = {
  status: "WRITING" | "THINKING" | "VALIDATING" | "SAVING" | "PAUSED" | "FAILED" | "COMPLETED"
  written: number
  currentChapter: number
}

const TITLE = "The Ledger of Later"
const TOTAL = 3

/** Create a conversation to hang the run on, once per test. */
async function createConversation(page: Page): Promise<string> {
  const id = await page.evaluate(async (title) => {
    const res = await fetch("/api/chat/conversations", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    })
    if (!res.ok) throw new Error(`create conversation failed: ${res.status}`)
    const body = await res.json()
    return body.data.id as string
  }, TITLE)
  return id
}

/** Publish a run exactly as the executing browser would. */
async function seedRun(page: Page, conversationId: string, run: FakeRun) {
  const status = await page.evaluate(
    async ({ conversationId, run, title, total }) => {
      const res = await fetch(`/api/conversations/${conversationId}/book-run`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          status: run.status,
          totalChapters: total,
          writtenChapters: run.written,
          currentChapter: run.currentChapter,
          manuscript: `# ${title}`,
        }),
      })
      return res.status
    },
    { conversationId, run, title: TITLE, total: TOTAL },
  )
  expect(status, "seeding the run should succeed").toBe(200)
  // The list is polled; a reload is the shortest way to a fresh read.
  await page.reload()
  await expect(chatRow(page)).toBeVisible({ timeout: 60_000 })
}

/** Leave no active run behind — the next test asserts a quiet sidebar. */
async function settleAllRuns(page: Page) {
  await page.evaluate(async () => {
    const res = await fetch("/api/book-runs", { credentials: "include" })
    if (!res.ok) return
    const body = await res.json()
    const runs = body.data.runs as { conversationId: string; title: string }[]
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

const chatRow = (page: Page) => page.getByRole("link", { name: /AI Chat/i }).first()
const spinner = (page: Page) => page.getByTestId("ai-task-spinner").first()
const popover = (page: Page) => page.getByTestId("ai-task-popover")

test.describe("the AI Chat running-work indicator", () => {
  test.describe.configure({ mode: "serial" })

  test.beforeEach(async ({ page }) => {
    await page.goto("/files")
    await expect(chatRow(page)).toBeVisible({ timeout: 60_000 })
    await settleAllRuns(page)
  })

  test.afterEach(async ({ page }) => {
    await settleAllRuns(page).catch(() => {})
  })

  test("stays quiet when nothing is running", async ({ page }) => {
    await page.reload()
    await expect(chatRow(page)).toBeVisible({ timeout: 60_000 })
    await expect(spinner(page)).toHaveCount(0)
    await expect(chatRow(page)).toHaveAttribute("href", "/chat")
  })

  test("spins on the AI Chat row while a book is being written", async ({ page }) => {
    const conversationId = await createConversation(page)
    await seedRun(page, conversationId, { status: "WRITING", written: 1, currentChapter: 2 })

    await expect(spinner(page), "the row should spin while work runs").toBeVisible({
      timeout: 20_000,
    })
    await expect(spinner(page)).toHaveAccessibleName(new RegExp(TITLE))
    await expect(spinner(page).locator(".animate-spin")).toHaveCount(1)
  })

  test("hovering shows what it is doing", async ({ page }) => {
    const conversationId = await createConversation(page)
    await seedRun(page, conversationId, { status: "WRITING", written: 1, currentChapter: 2 })

    await spinner(page).hover()
    await expect(popover(page)).toBeVisible({ timeout: 10_000 })
    await expect(popover(page)).toContainText(TITLE)
    await expect(popover(page)).toContainText("Writing Chapter 2 of 3")
    // Progress, the same numbers the Book Progress Card shows.
    await expect(popover(page)).toContainText("1 of 3 chapters")
  })

  test("reports the real phase, not a generic 'working'", async ({ page }) => {
    const conversationId = await createConversation(page)

    for (const [status, expected] of [
      ["THINKING", "Thinking · Chapter 2 of 3"],
      ["VALIDATING", "Checking Chapter 2 of 3"],
      ["SAVING", "Saving Chapter 2 of 3"],
    ] as const) {
      await seedRun(page, conversationId, { status, written: 1, currentChapter: 2 })
      await spinner(page).hover()
      await expect(popover(page)).toContainText(expected, { timeout: 10_000 })
      await page.mouse.move(600, 400)
    }
  })

  test("clicking goes to the conversation doing the work, not a new chat", async ({ page }) => {
    const conversationId = await createConversation(page)
    await seedRun(page, conversationId, { status: "WRITING", written: 1, currentChapter: 2 })

    await expect(chatRow(page)).toHaveAttribute("href", `/chat?c=${conversationId}`)
    await chatRow(page).click()
    await page.waitForURL(new RegExp(`/chat\\?c=${conversationId}`), { timeout: 30_000 })
  })

  test("stops spinning when the book is paused, failed or finished", async ({ page }) => {
    const conversationId = await createConversation(page)

    for (const status of ["PAUSED", "FAILED", "COMPLETED"] as const) {
      await seedRun(page, conversationId, { status, written: 2, currentChapter: 3 })
      await expect(
        spinner(page),
        `${status} is not work in progress`,
      ).toHaveCount(0)
      await expect(chatRow(page)).toHaveAttribute("href", "/chat")
    }
  })
})
