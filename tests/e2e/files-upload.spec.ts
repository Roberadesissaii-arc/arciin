import { readFileSync } from "node:fs"
import path from "node:path"

import { expect, test } from "@playwright/test"

/**
 * Deterministic files/upload gate for CI (ARC-011).
 *
 * Uploads through the same multipart route the app uses, then asserts the
 * file is visible on All Files. No external provider.
 */

const FIXTURE = path.resolve(__dirname, "../fixtures/e2e-image-fixture.png")

function uniqueName() {
  return `e2e-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`
}

test("uploading a file lists it on All Files", async ({ page, request }) => {
  test.setTimeout(120_000)
  const filename = uniqueName()

  const response = await request.post("/api/uploads", {
    multipart: {
      file: { name: filename, mimeType: "image/png", buffer: readFileSync(FIXTURE) },
    },
    timeout: 60_000,
  })
  expect(response.status(), await response.text()).toBe(201)
  const body = (await response.json()) as { data: { assetId: string | null } }

  let assetId = body.data.assetId
  if (!assetId) {
    const assets = await request.get("/api/assets", { timeout: 30_000 })
    const list = (await assets.json()) as { data: { id: string; originalFilename: string }[] }
    assetId = list.data.find((asset) => asset.originalFilename === filename)?.id ?? null
  }
  expect(assetId, `uploaded ${filename} but no asset id was returned`).toBeTruthy()

  try {
    await page.goto("/files")
    await expect(page.getByText(filename, { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    })
  } finally {
    if (assetId) {
      await request.delete(`/api/assets/${assetId}`, { timeout: 30_000 })
      await request.delete(`/api/trash/${assetId}`, { timeout: 30_000 })
    }
  }
})
