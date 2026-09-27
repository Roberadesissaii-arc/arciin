import { createHash, randomBytes } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, open, rm } from "node:fs/promises"
import path from "node:path"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"

import { suppressWindowsDesktopPromo } from "./desktop-promo"

/**
 * A large file sent through a File Request link, in a real browser.
 *
 * The owner makes the link the way a person does (right-click a folder →
 * Request files…); a signed-out visitor uploads through it while the network
 * drops, stays down long enough to give up, and the page is reloaded mid-file.
 * The file that lands in the folder must be byte-for-byte the one chosen.
 *
 * Size defaults to 80 MB so CI stays quick; `E2E_LARGE_UPLOAD_MB=1024` runs the
 * same flow with a realistic 1 GB file on a machine with room for it.
 */

const SIZE_MB = Number(process.env.E2E_LARGE_UPLOAD_MB ?? 80)
const SIZE = SIZE_MB * 1024 * 1024
const CHUNK_PATH = /\/api\/public\/file-requests\/[^/]+\/uploads\/[^/]+\/chunks\?offset=(\d+)/

test.setTimeout(Math.max(300_000, SIZE_MB * 1_500))

async function writeRandomFile(file: string, size: number) {
  await mkdir(path.dirname(file), { recursive: true })
  const handle = await open(file, "w")
  const hash = createHash("sha256")
  try {
    for (let written = 0; written < size; ) {
      const piece = randomBytes(Math.min(8 * 1024 * 1024, size - written))
      hash.update(piece)
      await handle.write(piece)
      written += piece.length
    }
  } finally {
    await handle.close()
  }
  return hash.digest("hex")
}

async function sha256OfStream(stream: AsyncIterable<Uint8Array>) {
  const hash = createHash("sha256")
  let bytes = 0
  for await (const piece of stream) {
    hash.update(piece)
    bytes += piece.length
  }
  return { sha256: hash.digest("hex"), bytes }
}

/** Streams the download instead of buffering a possibly 1 GB body in the runner. */
async function downloadHash(request: APIRequestContext, baseURL: string, assetId: string) {
  const { cookies } = await request.storageState()
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join("; ")
  const res = await fetch(new URL(`/api/assets/${assetId}/download`, baseURL), { headers: { cookie } })
  expect(res.status).toBe(200)
  return sha256OfStream(res.body as unknown as AsyncIterable<Uint8Array>)
}

async function createRequestLinkThroughUi(page: Page, request: APIRequestContext, folderName: string) {
  const libraries = (await (await request.get("/api/libraries")).json()).data as Array<{ id: string; slug: string }>
  const documents = libraries.find((l) => l.slug === "documents")
  expect(documents, "the seeded instance has a Documents library").toBeTruthy()
  const folderRes = await request.post(`/api/libraries/${documents!.id}/folders`, { data: { name: folderName } })
  expect(folderRes.status()).toBe(201)
  const folderId = (await folderRes.json()).data.id as string

  await suppressWindowsDesktopPromo(page)
  await page.goto("/documents")
  const card = page.getByRole("link", { name: new RegExp(folderName) })
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click({ button: "right" })
  await page.getByTestId("folder-request-files").click()
  await page.getByTestId("file-request-title").fill(`Large upload ${folderName}`)
  await page.getByTestId("file-request-create").click()
  const url = await page.getByTestId("file-request-url").inputValue({ timeout: 15_000 })
  expect(url).toMatch(/\/request\//)
  return { folderId, url: new URL(url).pathname, token: new URL(url).pathname.split("/").pop()! }
}

async function cleanup(request: APIRequestContext, folderId: string, assetIds: string[]) {
  const requests = (await (await request.get("/api/file-requests")).json()).data as Array<{ id: string; tokenPrefix?: string; folderId?: string }>
  for (const fr of requests.filter((r) => r.folderId === folderId)) {
    await request.post(`/api/file-requests/${fr.id}/revoke`)
  }
  for (const id of assetIds) {
    await request.delete(`/api/assets/${id}`)
    await request.delete(`/api/trash/${id}`)
  }
  await request.delete(`/api/folders/${folderId}`)
}

test("a large upload survives a dropped connection, a long outage and Resume, and lands intact", async ({
  page,
  browser,
  request,
  baseURL,
}, testInfo) => {
  const folderName = `resumable-${Date.now()}`
  const source = path.join(testInfo.outputDir, `large-${SIZE_MB}mb.bin`)
  const expected = await writeRandomFile(source, SIZE)
  const { folderId, url, token } = await createRequestLinkThroughUi(page, request, folderName)
  const assetIds: string[] = []

  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const pub = await visitor.newPage()
  try {
    const view = (await (await request.get(`/api/public/file-requests/${token}`)).json()).data
    const chunkSize = view.upload.chunkSize as number
    expect(view.upload.resumable).toBe(true)
    expect(chunkSize).toBeGreaterThan(0)
    expect(chunkSize).toBeLessThanOrEqual(64 * 1024 * 1024)
    const totalChunks = Math.ceil(SIZE / chunkSize)
    const dropAt = Math.max(1, Math.floor(totalChunks * 0.2)) * chunkSize
    const outageAt = Math.max(2, Math.floor(totalChunks * 0.7)) * chunkSize

    // Every byte goes up in requests no larger than one chunk.
    let largestBody = 0
    const offsetsSent: number[] = []
    let dropped = false
    let outage = false
    let outageOver = false
    await pub.route(CHUNK_PATH, async (route) => {
      const offset = Number(CHUNK_PATH.exec(route.request().url())![1])
      largestBody = Math.max(largestBody, route.request().postDataBuffer()?.length ?? 0)
      if (offset === dropAt && !dropped) {
        dropped = true
        return route.abort("connectionreset")
      }
      if (offset === outageAt && !outageOver) {
        outage = true
        return route.abort("internetdisconnected")
      }
      offsetsSent.push(offset)
      return route.continue()
    })

    await pub.goto(url)
    await expect(pub.getByTestId("file-request-max-size")).toBeVisible()
    await pub.getByTestId("file-request-input").setInputFiles(source)
    await pub.getByTestId("file-request-submit").click()

    const item = pub.getByTestId("file-request-item")
    // First drop: the page says so and carries on by itself.
    await expect(item).toContainText(/Connection interrupted\. Retrying/, { timeout: 120_000 })
    // Second: the network stays down past every retry (1+2+4+8+16 s).
    await expect(item).toHaveAttribute("data-status", "stalled", { timeout: 180_000 })
    await expect(item).toContainText(/Unable to reconnect/)
    expect(outage).toBe(true)

    outageOver = true
    await pub.getByTestId("file-request-resume").click()
    await expect(pub.getByTestId("file-request-success")).toBeVisible({ timeout: Math.max(120_000, SIZE_MB * 1_000) })

    expect(largestBody).toBeLessThanOrEqual(chunkSize)
    // Resumed, not restarted: offset 0 was sent exactly once.
    expect(offsetsSent.filter((o) => o === 0)).toHaveLength(1)

    const assets = (await (await request.get(`/api/assets?folderId=${folderId}`)).json()).data as Array<{
      id: string
      originalFilename?: string
      filename?: string
      sizeBytes: number | string
    }>
    expect(assets).toHaveLength(1)
    assetIds.push(assets[0].id)
    expect(Number(assets[0].sizeBytes)).toBe(SIZE)
    const got = await downloadHash(request, baseURL!, assets[0].id)
    expect(got.bytes).toBe(SIZE)
    expect(got.sha256).toBe(expected)
  } finally {
    await visitor.close()
    await cleanup(request, folderId, assetIds)
    await rm(source, { force: true })
  }
})

test("reloading the request page mid-upload resumes from the server's offset", async ({
  page,
  browser,
  request,
  baseURL,
}, testInfo) => {
  const size = Math.min(SIZE, 64 * 1024 * 1024)
  const folderName = `resumable-reload-${Date.now()}`
  const source = path.join(testInfo.outputDir, "reload.bin")
  const expected = await writeRandomFile(source, size)
  const { folderId, url, token } = await createRequestLinkThroughUi(page, request, folderName)
  const assetIds: string[] = []

  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const pub = await visitor.newPage()
  try {
    const chunkSize = (await (await request.get(`/api/public/file-requests/${token}`)).json()).data.upload.chunkSize as number
    // Two chunks reach the server; after that the network "fails" until the
    // visitor reloads, so the upload cannot finish before the reload happens.
    let stored = 0
    let beforeReload = true
    await pub.route(CHUNK_PATH, async (route) => {
      const offset = Number(CHUNK_PATH.exec(route.request().url())![1])
      if (beforeReload && offset >= 2 * chunkSize) return route.abort("connectionreset")
      const res = await route.fetch()
      if (beforeReload && res.ok()) stored += 1
      return route.fulfill({ response: res })
    })
    await pub.goto(url)
    await pub.getByTestId("file-request-input").setInputFiles(source)
    await pub.getByTestId("file-request-submit").click()
    await expect.poll(() => stored, { timeout: 60_000 }).toBe(2)
    await pub.reload()
    beforeReload = false

    const afterReload: number[] = []
    pub.on("request", (req) => {
      const m = CHUNK_PATH.exec(req.url())
      if (m) afterReload.push(Number(m[1]))
    })
    // Choosing the same file again picks the saved session back up.
    await pub.getByTestId("file-request-input").setInputFiles(source)
    await pub.getByTestId("file-request-submit").click()
    await expect(pub.getByTestId("file-request-success")).toBeVisible({ timeout: 120_000 })
    expect(afterReload.length).toBeGreaterThan(0)
    // Straight to the server's offset: nothing already stored is sent again.
    expect(afterReload[0]).toBe(2 * chunkSize)

    const assets = (await (await request.get(`/api/assets?folderId=${folderId}`)).json()).data as Array<{ id: string; sizeBytes: number | string }>
    expect(assets).toHaveLength(1)
    assetIds.push(assets[0].id)
    const got = await downloadHash(request, baseURL!, assets[0].id)
    expect(got.sha256).toBe(expected)
  } finally {
    await visitor.close()
    await cleanup(request, folderId, assetIds)
    await rm(source, { force: true })
  }
})

test("sha256 helper streams", async () => {
  // Guard the helper the assertions above rely on.
  const file = path.join(test.info().outputDir, "tiny.bin")
  const expected = await writeRandomFile(file, 1234)
  const got = await sha256OfStream(createReadStream(file))
  expect(got).toEqual({ sha256: expected, bytes: 1234 })
  await rm(file, { force: true })
})
