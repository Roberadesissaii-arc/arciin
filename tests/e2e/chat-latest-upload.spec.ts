import { readFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

/**
 * The chat answer for "what is the latest upload" must render a file card.
 *
 * The model's words are the *input* to the code this covers, so they are
 * pinned rather than generated: the reply below is verbatim what the local
 * model produced when the bug was reported — prose promising a file, with no
 * `[[ASSETS:…]]` tag of its own. Everything downstream is the real app:
 * `finalizeAssistantContent`, the markdown renderer, the live `/api/assets`
 * fetch, and the real card grid.
 *
 * Before the fix this rendered the sentence and nothing else, because the
 * gallery gate read "upload"/"files" phrasing as small talk and stripped the
 * tag. Generating the reply for real is not viable on a CPU-only host — the
 * smallest local model needs minutes per turn — and would make the assertion
 * depend on the model's mood rather than on this code.
 *
 * The *recency* is not pinned, it is created. This test used to assert that a
 * seeded fixture was the newest asset in the dev instance, which was true only
 * as long as nothing else had been added since — another spec, an earlier run,
 * or a developer using the same instance would each break it, and the failure
 * looked like a chat bug rather than a stale assumption. Now the test uploads
 * its own file through the real upload route, so the asset it asserts on is by
 * construction the most recent one, and removes it again afterwards.
 */

/** Verbatim from the reported transcript. */
const MODEL_REPLY =
  "Your last upload was about 20 minutes ago — here's the most recent file:"

const FIXTURE = path.resolve(__dirname, "../fixtures/e2e-image-fixture.png")

/** Unique per run, so no earlier run's leftovers can satisfy the assertion. */
function uniqueName() {
  return `e2e-latest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
}

/**
 * Upload through the API the app itself uses. The asset is created before the
 * 201 returns, so once this resolves it is genuinely the newest thing here.
 */
async function uploadNewest(request: APIRequestContext, filename: string) {
  const response = await request.post("/api/uploads", {
    multipart: {
      file: { name: filename, mimeType: "image/png", buffer: readFileSync(FIXTURE) },
    },
    timeout: 60_000,
  })
  expect(response.status(), await response.text()).toBe(201)
  const body = (await response.json()) as { data: { assetId: string | null } }
  if (body.data.assetId) return body.data.assetId

  // The upload row is serialized as it was read; look the asset up by name if
  // it had not been re-read after creation.
  const assets = await request.get("/api/assets", { timeout: 30_000 })
  const list = (await assets.json()) as { data: { id: string; originalFilename: string }[] }
  const found = list.data.find((a) => a.originalFilename === filename)
  expect(found, `uploaded ${filename} but it is not in /api/assets`).toBeTruthy()
  return found!.id
}

/** Leave the instance as we found it: soft-delete, then empty it from Trash. */
async function removeAsset(request: APIRequestContext, assetId: string) {
  await request.delete(`/api/assets/${assetId}`, { timeout: 30_000 })
  await request.delete(`/api/trash/${assetId}`, { timeout: 30_000 })
}

async function stubChatStream(page: Page, reply: string) {
  await page.route("**/api/chat", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback()
      return
    }
    const body =
      reply
        .split(" ")
        .map((word, i) => `data: ${JSON.stringify({ text: i === 0 ? word : ` ${word}` })}\n\n`)
        .join("") + "data: [DONE]\n\n"
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      body,
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

test("asking for the latest upload renders the file card", async ({ page }) => {
  const filename = uniqueName()
  const assetId = await uploadNewest(page.request, filename)

  try {
    await stubChatStream(page, MODEL_REPLY)
    await page.goto("/chat")
    await ask(page, "what is the latest upload")

    await expect(page.getByText("most recent file")).toBeVisible({ timeout: 30_000 })

    // The newest asset is the one this test just uploaded — not whatever the
    // instance happened to be holding.
    const card = page.getByRole("button", { name: new RegExp(filename, "i") })
    await expect(card.first()).toBeVisible({ timeout: 30_000 })

    // Exactly one card: "the latest upload" is singular, so the tag is :1.
    const allCards = page.getByRole("button", { name: /e2e-|\.(png|mp4|pdf)\b/i })
    expect(await allCards.count()).toBe(1)

    await page.screenshot({ path: "test-results/chat-latest-upload.png" })

    // The tag itself must never leak into the transcript as literal text.
    await expect(page.locator("body")).not.toContainText("[[ASSETS:")
  } finally {
    await removeAsset(page.request, assetId)
  }
})

test("a generic files question renders the cross-library gallery", async ({ page }) => {
  await stubChatStream(page, "Here's an overview of your recent files across all libraries:")
  await page.goto("/chat")
  await ask(page, "my files")

  const cards = page.getByRole("button", { name: /e2e-|\.(png|mp4|pdf)\b/i })
  await expect(cards.first()).toBeVisible({ timeout: 30_000 })
  // Not narrowed to one — a plural request shows the set.
  expect(await cards.count()).toBeGreaterThan(1)

  await page.screenshot({ path: "test-results/chat-my-files.png" })
})
