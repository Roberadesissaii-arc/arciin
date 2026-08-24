import { expect, test, type Page } from "@playwright/test"

/**
 * A filtered answer must render the books it named — and nothing else.
 *
 * Reported case: "list all book which is Fictional story". The prose was
 * correct (22 novels across Fiction and Sci-Fi & Fantasy) and the cover grid
 * underneath showed TensorFlow manuals, IELTS workbooks and a Bible prophecy
 * overview, because `[[ASSETS:documents]]` renders the most *recent*
 * documents and knows nothing about the sentence above it.
 *
 * The model's reply is pinned verbatim from that transcript: it is the input
 * to the code under test, and generating it for real on a CPU-only host takes
 * minutes per turn. Everything below the reply is the live app — the intent
 * pipeline, the title matcher, the real /api/assets fetch, the real cards.
 */

/** Verbatim from the reported transcript. */
const FICTION_REPLY = `Here's every fictional story book in your Documents library — all 22 are in the Fiction and Sci-Fi & Fantasy folders.

Fiction (7)

1. Hamlet (William Shakespeare)
2. Mythology — Timeless Tales of Gods and Heroes (Edith Hamilton)
3. Mythology 101 (Kathleen Sears)
4. Pumpkinheads (Rainbow Rowell & Faith Erin Hicks)
5. The Bell Under Wintermere
6. The Sunken Signal
7. The Last Signal

Sci-Fi & Fantasy (15)

1. Harry Potter and the Sorcerer's Stone (Book 1)
2. Harry Potter and the Chamber of Secrets (Book 2)
3. Harry Potter and the Prisoner of Azkaban (Book 3)
4. Harry Potter and the Goblet of Fire
5. Harry Potter and the Half-Blood Prince
6. Harry Potter and the Cursed Child (Book 8)
7. Harry Potter — The Complete Collection (1–7)
8. Departure (A.G. Riddle)
9. The Atlantis Gene (2 copies)
10. The Atlantis Plague (2 copies)
11. The Atlantis World (3 copies)`

const SINGLE_BOOK_REPLY = `Found it in your Sci-Fi & Fantasy folder.

- Harry Potter and the Goblet of Fire`

/** Books the library holds that are emphatically not fiction. */
const NON_FICTION = [
  /TensorFlow/i,
  /IELTS/i,
  /Spacetime and Geometry/i,
  /Modern Web/i,
  /Nikola Tesla/i,
  /Dropshipping/i,
]

async function stubChatStream(page: Page, reply: string) {
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body: `data: ${JSON.stringify({ text: reply })}\n\ndata: [DONE]\n\n`,
    })
  })
}

async function ask(page: Page, question: string) {
  const composer = page.locator("textarea").first()
  await composer.waitFor({ state: "visible", timeout: 60_000 })
  await expect(composer).toBeEnabled({ timeout: 30_000 })
  await composer.fill(question)
  await composer.press("Enter")
}

/** Cards carry a filename and a size badge; the expander is a button too. */
function assetCards(page: Page) {
  return page.getByRole("button", { name: /\.(pdf|png|mp4|txt|epub)\b/i })
}

test("a fiction-only answer shows only the fiction books", async ({ page }) => {
  await stubChatStream(page, FICTION_REPLY)
  await page.goto("/chat")
  await ask(page, "list all book which is Fictional story")

  await expect(page.getByText("Hamlet (William Shakespeare)").first()).toBeVisible({
    timeout: 30_000,
  })

  // 20 of the 22 titles exist in this instance; the count proves the matcher
  // resolved the whole list rather than a lucky handful.
  await expect(page.getByRole("button", { name: /\(20 listed\)/ })).toBeVisible({
    timeout: 30_000,
  })

  await page.getByRole("button", { name: /\(20 listed\)/ }).click()
  await expect(assetCards(page)).toHaveCount(20)

  for (const pattern of NON_FICTION) {
    await expect(
      assetCards(page).filter({ hasText: pattern }),
      `${pattern} must not be rendered on a fiction answer`,
    ).toHaveCount(0)
  }

  await expect(assetCards(page).filter({ hasText: /Atlantis World/i })).toHaveCount(3)
  await page.screenshot({ path: "test-results/chat-fiction-books.png", fullPage: true })
})

test("naming one book shows that one book", async ({ page }) => {
  await stubChatStream(page, SINGLE_BOOK_REPLY)
  await page.goto("/chat")
  await ask(page, "show me Harry Potter and the Goblet of Fire")

  const cards = assetCards(page)
  await expect(cards.first()).toBeVisible({ timeout: 30_000 })
  await expect(cards).toHaveCount(1)
  await expect(cards.first()).toContainText(/Goblet of Fire/i)

  await page.screenshot({ path: "test-results/chat-single-book.png" })
})

test("a series request shows the series, not the library", async ({ page }) => {
  await stubChatStream(
    page,
    `You have seven Atlantis files — the trilogy plus duplicates.

1. The Atlantis Gene
2. The Atlantis Plague
3. The Atlantis World`,
  )
  await page.goto("/chat")
  await ask(page, "show me all the Atlantis books")

  const cards = assetCards(page)
  await expect(cards.first()).toBeVisible({ timeout: 30_000 })
  await expect(cards).toHaveCount(7)
  await expect(cards.filter({ hasText: /Atlantis/i })).toHaveCount(7)

  await page.screenshot({ path: "test-results/chat-series.png" })
})

test("an unfiltered browse still shows the recent-documents gallery", async ({ page }) => {
  await stubChatStream(page, "Here are your books — 245 documents in this library.")
  await page.goto("/chat")
  await ask(page, "show me my books")

  const cards = assetCards(page)
  await expect(cards.first()).toBeVisible({ timeout: 30_000 })
  // The recency gallery, untouched by the filtering work.
  expect(await cards.count()).toBeGreaterThan(5)

  await page.screenshot({ path: "test-results/chat-unfiltered.png" })
})
