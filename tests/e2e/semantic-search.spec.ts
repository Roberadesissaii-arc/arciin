import { expect, test, type Page } from "@playwright/test"

import { suppressWindowsDesktopPromo } from "./desktop-promo"

/**
 * The semantic search settings card and the search-result hints, in a real
 * browser. The status and search answers are fixtures, so every state shows
 * up without a model; the server side is tests/integration/semantic-search.
 */

const base = {
  enabled: true,
  indexingActive: false,
  provider: "Local Ollama",
  embeddingModel: "nomic-embed-text",
  model: { state: "installed", sizeBytes: 274_302_450, dimension: 768, digest: "0a109f422b47" },
  captionModel: "qwen3.5:0.8b",
  index: { state: "not_indexed", eligible: 930, indexed: 0, pending: 930, failed: 0, skipped: 0 },
  install: null,
}

async function card(page: Page, status: Record<string, unknown>, calls: string[] = []) {
  let current = status
  await page.route("**/api/semantic-search/**", async (route) => {
    const url = new URL(route.request().url())
    const action = `${route.request().method()} ${url.pathname.replace(/^.*\/semantic-search/, "")}`
    calls.push(action)
    if (action === "POST /index") current = { ...current, indexingActive: true, index: { ...(current.index as object), state: "indexing" } }
    if (action === "PATCH /settings") current = { ...current, enabled: !current.enabled }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: current }) })
  })
  await suppressWindowsDesktopPromo(page)
  await page.goto("/models")
  const el = page.getByTestId("semantic-search-card")
  await expect(el).toBeVisible({ timeout: 60_000 })
  return el
}

test("off: says so, and offers Enable", async ({ page }) => {
  const el = await card(page, { ...base, enabled: false, index: { ...base.index, state: "off" } })
  await expect(el.getByTestId("semantic-status")).toContainText("Semantic search")
  await expect(el.getByTestId("semantic-status")).toContainText("Off")
  await expect(el.getByTestId("semantic-toggle")).toHaveText("Enable")
  await expect(el.getByTestId("semantic-index")).toHaveCount(0)
})

test("model missing: explains, and installs only when asked", async ({ page }) => {
  const calls: string[] = []
  const el = await card(page, { ...base, model: { state: "missing", sizeBytes: null, dimension: null, digest: null } }, calls)
  await expect(el.getByTestId("semantic-model-missing")).toContainText("Semantic search needs a local embedding model")
  await expect(el.getByTestId("semantic-model-state")).toHaveText("Not installed")
  expect(calls.filter((c) => c.startsWith("POST"))).toEqual([])
  await el.getByTestId("semantic-install").click()
  // A confirmation first, saying what is downloaded; nothing is sent yet.
  const dialog = page.getByRole("alertdialog")
  await expect(dialog).toContainText("Install nomic-embed-text?")
  await expect(dialog).toContainText("nothing from your library is sent anywhere")
  expect(calls.filter((c) => c.startsWith("POST"))).toEqual([])
  await dialog.getByRole("button", { name: "Cancel" }).click()
  expect(calls.filter((c) => c.startsWith("POST"))).toEqual([])
  await el.getByTestId("semantic-install").click()
  await page.getByTestId("semantic-install-confirm").click()
  await expect.poll(() => calls).toContain("POST /model/install")
})

test("indexing: shows progress and counts; ready: says Ready", async ({ page }) => {
  const el = await card(page, {
    ...base,
    indexingActive: true,
    index: { state: "indexing", eligible: 930, indexed: 742, pending: 180, failed: 8, skipped: 0 },
  })
  await expect(el.getByTestId("semantic-index-state")).toHaveText("Indexing")
  await expect(el.getByTestId("semantic-index-counts")).toContainText("742 / 930 files")
  await expect(el.getByTestId("semantic-index-counts")).toContainText("180 pending")
  await expect(el.getByTestId("semantic-index-counts")).toContainText("8 failed")
  await expect(el.getByRole("progressbar")).toBeVisible()
  await expect(el.getByTestId("semantic-model-state")).toContainText("Installed")
})

test("indexing starts only when the owner clicks Index library", async ({ page }) => {
  const calls: string[] = []
  const el = await card(page, base, calls)
  expect(calls.filter((c) => c.startsWith("POST"))).toEqual([])
  await el.getByTestId("semantic-index").click()
  await expect(el.getByTestId("semantic-index-state")).toHaveText("Indexing")
  expect(calls).toContain("POST /index")
})

test("Ollama offline: says so, calmly", async ({ page }) => {
  const el = await card(page, { ...base, model: { state: "ollama_offline", sizeBytes: null, dimension: null, digest: null } })
  await expect(el.getByTestId("semantic-model-state")).toHaveText("Ollama offline")
  await expect(el.getByTestId("semantic-offline")).toContainText("Search keeps working by name")
})

test("results found by meaning carry a word label, and an unavailable model shows one quiet line", async ({ page }) => {
  let semantic = "used"
  await page.route("**/api/assets/page**", async (route) => {
    const url = new URL(route.request().url())
    if (!url.searchParams.get("search")) return route.continue()
    const now = new Date().toISOString()
    const item = (id: string, name: string, match?: string) => ({
      id, libraryId: "l", folderId: null, storageObjectId: "s", ownerId: "o", filename: name, originalFilename: name, title: null,
      mimeType: "image/jpeg", mediaType: "IMAGE", extension: "jpg", sizeBytes: 31690, checksumSha256: "x", status: "READY",
      createdAt: now, updatedAt: now, ai: {}, ...(match ? { searchMatch: { kind: "semantic", label: match } } : {}),
    })
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          items: semantic === "used" ? [item("a1", "IMG_0042.jpg", "Matched by meaning")] : [],
          nextCursor: null,
          hasMore: false,
          total: semantic === "used" ? 1 : 0,
          semantic,
        },
      }),
    })
  })
  await suppressWindowsDesktopPromo(page)
  await page.goto("/files")
  const box = page.getByPlaceholder(/Search files/).first()
  await box.fill("birthday party")
  await expect(page.getByTestId("asset-search-match").first()).toContainText("Matched by meaning", { timeout: 30_000 })
  await expect(page.getByTestId("asset-search-match").first()).not.toContainText(/\d/)
  semantic = "unavailable"
  await box.fill("birthday cake")
  await expect(page.getByTestId("semantic-unavailable")).toHaveText("Semantic search unavailable — showing name matches.", { timeout: 30_000 })
})
