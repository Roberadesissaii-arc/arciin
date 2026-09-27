import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { generateShareToken } from "../../apps/api/src/services/shares/share-access"
import {
  createAsset,
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

/**
 * A public share link never renders active content on the app's origin.
 *
 * Found in the v1.1.0 pentest: `?inline=1` served an uploaded HTML file as
 * text/html inline, with no sandbox. The owner is usually signed in when they
 * open their own share links, so script in that file ran with their session.
 * The share thumbnail fallback did the same for an SVG that failed to
 * rasterise. Both now follow the signed-in asset route's rule.
 */

let fixtures: Fixtures
let app: Awaited<ReturnType<typeof buildApp>>

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerShareRoutes } = await import("../../apps/api/src/modules/shares/routes")
  const a = Fastify({ logger: false })
  a.decorate("prisma", prisma)
  a.decorate("redis", { incr: async () => 1, expire: async () => 1, get: async () => null, del: async () => 1, set: async () => "OK" })
  a.decorate("publishRealtimeEvent", async () => {})
  await registerCookies(a)
  await a.register(async (api) => registerShareRoutes(api), { prefix: "/api" })
  await a.ready()
  return a
}

async function sharedFile(input: { name: string; mime: string; ext: string; mediaType: "DOCUMENT" | "IMAGE" | "OTHER"; body: string }) {
  const asset = await createAsset(fixtures, {
    librarySlug: input.mediaType === "IMAGE" ? "images" : "inbox",
    mediaType: input.mediaType,
    originalFilename: input.name,
    extension: input.ext,
    mimeType: input.mime,
  })
  const so = await prisma.storageObject.findUniqueOrThrow({ where: { id: asset.storageObjectId } })
  await mkdir(path.dirname(so.physicalPath), { recursive: true })
  await writeFile(so.physicalPath, input.body)
  await prisma.storageObject.update({ where: { id: so.id }, data: { sizeBytes: BigInt(input.body.length), mimeType: input.mime } })
  const { rawToken, tokenHash, tokenPrefix } = generateShareToken()
  await prisma.shareLink.create({
    data: { createdById: fixtures.user.id, resourceType: "ASSET", assetId: asset.id, tokenHash, tokenPrefix, allowDownload: true },
  })
  return { asset, token: rawToken }
}

beforeAll(async () => {
  const root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
  await prisma.instanceConfig.deleteMany()
  await prisma.instanceConfig.create({
    data: { instanceName: "Share", storageRoot: root, initializedAt: new Date(), licensePlan: "free", licenseStatus: "none" },
  })
  app = await buildApp()
})

afterAll(async () => {
  await app?.close()
  await prisma.shareLink.deleteMany()
  await prisma.instanceConfig.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

describe("share download with ?inline=1", () => {
  it.each([
    ["page.html", "text/html", "html"],
    ["drawing.svg", "image/svg+xml", "svg"],
    ["app.js", "text/javascript", "js"],
    ["data.xml", "application/xml", "xml"],
  ])("%s is an attachment, sandboxed, never inline", async (name, mime, ext) => {
    const { asset, token } = await sharedFile({ name, mime, ext, mediaType: "OTHER", body: "<script>alert(1)</script>" })
    const res = await app.inject({ method: "GET", url: `/api/shares/access/${token}/download/${asset.id}?inline=1` })
    expect(res.statusCode).toBe(200)
    expect(String(res.headers["content-disposition"])).toMatch(/^attachment;/)
    expect(res.headers["content-security-policy"]).toBe("sandbox; default-src 'none'")
    expect(res.headers["x-content-type-options"]).toBe("nosniff")
  })

  it("a PNG still previews inline", async () => {
    const { asset, token } = await sharedFile({ name: "photo.png", mime: "image/png", ext: "png", mediaType: "IMAGE", body: "\x89PNG" })
    const res = await app.inject({ method: "GET", url: `/api/shares/access/${token}/download/${asset.id}?inline=1` })
    expect(String(res.headers["content-disposition"])).toMatch(/^inline;/)
  })

  it("a filename cannot inject headers", async () => {
    const { asset, token } = await sharedFile({ name: 'a"\r\nSet-Cookie: x=1.txt', mime: "text/plain", ext: "txt", mediaType: "DOCUMENT", body: "hi" })
    const res = await app.inject({ method: "GET", url: `/api/shares/access/${token}/download/${asset.id}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers["set-cookie"]).toBeUndefined()
  })
})

describe("share thumbnail fallback", () => {
  it("never streams an SVG original in place of a thumbnail", async () => {
    // Not valid SVG, so rasterising fails and the fallback path is taken.
    const { asset, token } = await sharedFile({
      name: "evil.svg",
      mime: "image/svg+xml",
      ext: "svg",
      mediaType: "IMAGE",
      body: "<svg><script>alert(document.cookie)</script",
    })
    const res = await app.inject({ method: "GET", url: `/api/shares/access/${token}/thumbnail/${asset.id}` })
    expect(res.headers["content-type"] ?? "").not.toContain("svg")
    expect(res.body).not.toContain("<script>")
  })
})
