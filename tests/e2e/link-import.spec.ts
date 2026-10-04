import { expect, test, type Page } from "@playwright/test"

import { suppressWindowsDesktopPromo } from "./desktop-promo"

/**
 * Import from link, in a real browser. The server's inspect and batch answers
 * are served from fixtures so every state is exercised without reaching any
 * third-party site; the server side of both endpoints is covered by
 * tests/integration/link-import.test.ts.
 */

const video = (n: number) => ({
  id: `c${n}`,
  url: `https://cdn.example.com/v${n}.mp4`,
  title: `Clip ${n}`,
  hasThumbnail: false,
  durationSeconds: 60 * n + 5,
  source: "cdn.example.com",
  category: "video",
})

type Inspect = Record<string, unknown> | { status: number; error: { code: string; message: string } }

async function openSheet(page: Page, answers: Record<string, Inspect>, batches: Array<Record<string, unknown>> = []) {
  await page.route("**/api/imports/inspect", async (route) => {
    const { url } = route.request().postDataJSON() as { url: string }
    const answer = answers[url] ?? { kind: "none", items: [], title: null, reason: null }
    if ("error" in answer) {
      return route.fulfill({ status: Number(answer.status), contentType: "application/json", body: JSON.stringify({ error: answer.error }) })
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: { inspectionId: "insp_fixture_0123456789", url, title: null, reason: null, ...answer } }),
    })
  })
  await page.route("**/api/imports/batch", async (route) => {
    const body = route.request().postDataJSON() as { itemIds: string[] }
    batches.push(body)
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          accepted: body.itemIds.map((itemId, i) => ({
            itemId,
            state: i < 3 ? "started" : "waiting",
            upload: { id: `up-${itemId}`, originalFilename: `Clip ${itemId}`, status: "QUEUED", progress: 0, sizeBytes: 0, mimeType: null, targetLibrary: null },
          })),
          rejected: [],
        },
      }),
    })
  })
  await suppressWindowsDesktopPromo(page)
  await page.goto("/dashboard")
  await page.getByRole("button", { name: "Import from link" }).first().click()
  return page.getByTestId("import-link-input")
}

test("a scheme-less link is accepted and shown in full once the field is left", async ({ page }) => {
  const input = await openSheet(page, {})
  await expect(input).toHaveAttribute("placeholder", "Paste a link or enter example.com")
  await input.fill("example.com")
  await input.blur()
  await expect(input).toHaveValue("https://example.com/")
  await expect(page.getByTestId("import-link-status")).toHaveText("No downloadable public media found on this page.", { timeout: 15_000 })
  await expect(page.getByTestId("import-link-submit")).toHaveText("Try importing anyway")
})

test("typing is not rewritten mid-word", async ({ page }) => {
  const input = await openSheet(page, {})
  await input.pressSequentially("www.exam")
  await expect(input).toHaveValue("www.exam")
})

test("a single item keeps the normal preview and the one-click import", async ({ page }) => {
  const input = await openSheet(page, {
    "https://www.youtube.com/watch?v=abcDEF12345": { kind: "single", items: [{ ...video(1), source: "YouTube" }] },
  })
  await input.fill("youtube.com/watch?v=abcDEF12345")
  await input.blur()
  await expect(input).toHaveValue("https://youtube.com/watch?v=abcDEF12345")
  await expect(page.getByTestId("import-candidates")).toHaveCount(0)
})

test("several items become a picker: select, choose a format, import — bounded to five", async ({ page }) => {
  const batches: Array<Record<string, unknown>> = []
  const input = await openSheet(
    page,
    { "https://videos.example.com/gallery": { kind: "collection", title: "Gallery", items: [1, 2, 3, 4, 5].map(video) } },
    batches,
  )
  await input.fill("videos.example.com/gallery")
  const picker = page.getByTestId("import-candidates")
  await expect(picker).toBeVisible({ timeout: 15_000 })
  await expect(picker.getByRole("checkbox")).toHaveCount(5)
  await expect(page.getByTestId("import-link-submit")).toBeDisabled()
  await expect(page.getByTestId("import-link-submit")).toHaveText("Select items to import")

  await picker.getByRole("checkbox", { name: "Import Clip 2" }).click()
  await picker.getByRole("checkbox", { name: "Import Clip 4" }).click()
  await expect(page.getByTestId("import-candidates-count")).toHaveText("2 selected")
  // One format for the batch: audio only, MP3.
  await page.getByText("Audio only").click()
  await page.getByRole("button", { name: /MP3 audio/ }).click()
  await expect(page.getByTestId("import-link-submit")).toHaveText("Import 2 items")
  await page.getByTestId("import-link-submit").click()

  await expect.poll(() => batches.length).toBe(1)
  expect(batches[0]).toMatchObject({ inspectionId: "insp_fixture_0123456789", itemIds: ["c2", "c4"], audioOnly: true, audioFormat: "mp3" })
  // Only ids go up — never the candidates' URLs.
  expect(JSON.stringify(batches[0])).not.toContain("cdn.example.com")
})

test("Select all takes all five", async ({ page }) => {
  const batches: Array<Record<string, unknown>> = []
  const input = await openSheet(
    page,
    { "https://videos.example.com/all": { kind: "collection", title: null, items: [1, 2, 3, 4, 5].map(video) } },
    batches,
  )
  await input.fill("videos.example.com/all")
  await page.getByRole("button", { name: "Select all" }).click()
  await expect(page.getByTestId("import-candidates-count")).toHaveText("5 selected")
  await page.getByTestId("import-link-submit").click()
  await expect.poll(() => batches.length).toBe(1)
  expect((batches[0]!.itemIds as string[]).length).toBe(5)
})

test("DRM hosts are blocked at once; private addresses show the server's reason", async ({ page }) => {
  const input = await openSheet(page, {
    "https://127.0.0.1/": { status: 400, error: { code: "IMPORT_URL_BLOCKED", message: "Only public http(s) links can be imported." } },
  })
  await input.fill("open.spotify.com/track/abc")
  await expect(page.getByTestId("import-link-blocked")).toContainText("Spotify")
  await expect(page.getByTestId("import-link-submit")).toBeDisabled()

  await input.fill("127.0.0.1")
  await expect(page.getByTestId("import-link-blocked")).toContainText("Only public http(s) links", { timeout: 15_000 })
  await expect(page.getByTestId("import-link-submit")).toBeDisabled()
})

test("an inspection failure is a clear message with a way forward", async ({ page }) => {
  const input = await openSheet(page, {
    "https://flaky.example.com/": { status: 502, error: { code: "INSPECT_FAILED", message: "Could not inspect this link." } },
  })
  await input.fill("flaky.example.com")
  await expect(page.getByTestId("import-link-status")).toHaveText("Could not inspect this link.", { timeout: 15_000 })
  await expect(page.getByTestId("import-link-submit")).toBeEnabled()
})

test("non-web input is refused before anything is sent", async ({ page }) => {
  let inspected = 0
  page.on("request", (req) => {
    if (req.url().includes("/api/imports/inspect")) inspected++
  })
  const input = await openSheet(page, {})
  await input.fill("javascript:alert(1)")
  await expect(page.getByTestId("import-link-status")).toContainText("Only web links")
  await page.waitForTimeout(1200)
  expect(inspected).toBe(0)
})
