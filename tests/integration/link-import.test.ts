import Redis from "ioredis"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  IMPORT_MAX_ACTIVE_PER_USER,
  acquireImportSlot,
  importSlotsKey,
  importWaitingKey,
  promoteWaitingImports,
  releaseImportSlot,
  type RealtimeEvent,
} from "@arciin/shared"

import { hashToken } from "../../apps/api/src/services/security/auth"
import { prisma, resetDatabase } from "./setup"

/**
 * Link import at the API: normalisation, inspection, and bounded batch import.
 *
 * Real Postgres and Redis (db 15). The worker is not running: the inspection
 * runner is stubbed and queue adds are recorded, so what is asserted is the
 * API's own decisions — what it accepts, what it re-checks, what it starts
 * and what it makes wait.
 */

let app: Awaited<ReturnType<typeof buildApp>>
let redis: Redis
let userId: string
let otherUserId: string
let cookie: string
let otherCookie: string
const events: RealtimeEvent[] = []
const queued: Array<Record<string, unknown>> = []
let failQueueOn: string | null = null
let runner: { run: (url: string) => Promise<unknown> }
let thumbs: { fetch: (url: string) => Promise<unknown> }
let thumbCache: { clear: () => void }
let lastInspected: string[] = []

// Literal public addresses: no DNS needed for the guard to pass them.
const PUB = "https://93.184.215.14"

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerJsonBodyParser } = await import("../../apps/api/src/plugins/json-body")
  const { registerErrorHandler } = await import("../../apps/api/src/plugins/error-handler")
  const routes = await import("../../apps/api/src/modules/imports/routes")
  const queues = await import("../../apps/api/src/services/jobs/queues")
  vi.spyOn(queues.mediaQueue, "add").mockImplementation((async (_name: string, data: Record<string, unknown>) => {
    if (failQueueOn && String(data.url).includes(failQueueOn)) throw new Error("queue down")
    queued.push(data)
    return { id: String(queued.length) }
  }) as never)
  runner = routes.inspectRunner
  thumbs = routes.thumbnailFetcher
  thumbCache = routes.thumbnailCache
  const a = Fastify({ logger: false })
  a.decorate("prisma", prisma)
  a.decorate("redis", redis)
  a.decorate("publishRealtimeEvent", async (event: RealtimeEvent) => {
    events.push(event)
  })
  registerJsonBodyParser(a)
  await registerErrorHandler(a)
  await registerCookies(a)
  await a.register(async (api) => routes.registerImportRoutes(api), { prefix: "/api" })
  await a.ready()
  return a
}

async function sessionCookie(id: string) {
  const raw = `sess_${crypto.randomUUID()}`
  await prisma.session.create({ data: { userId: id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) } })
  return `arciin_session=${raw}`
}

const post = (url: string, payload: unknown, c = cookie) =>
  app.inject({ method: "POST", url: `/api${url}`, headers: { cookie: c }, payload: payload as Record<string, unknown> })

function stubInspection(outcome: unknown) {
  runner.run = async (url: string) => {
    lastInspected.push(url)
    return outcome
  }
}

const video = (n: number) => ({
  url: `${PUB}/clips/v${n}.mp4`,
  title: `Video ${n}`,
  thumbnail: null,
  durationSeconds: 60 + n,
  source: "93.184.215.14",
  category: "video",
})

beforeAll(async () => {
  await resetDatabase()
  redis = new Redis(process.env.REDIS_URL!)
  const make = async (email: string) =>
    (await prisma.user.create({ data: { email, name: email, passwordHash: "x", role: "OWNER", status: "ACTIVE" } })).id
  userId = await make("importer@example.invalid")
  otherUserId = await make("other@example.invalid")
  cookie = await sessionCookie(userId)
  otherCookie = await sessionCookie(otherUserId)
  app = await buildApp()
})

afterAll(async () => {
  await app?.close()
  for (const id of [userId, otherUserId]) {
    await redis.del(importSlotsKey(id), importWaitingKey(id), `import:inspecting:${id}`)
  }
  const keys = await redis.keys("import:inspect:*")
  if (keys.length) await redis.del(...keys)
  await redis.quit()
  await resetDatabase()
  await prisma.$disconnect()
})

beforeEach(async () => {
  events.length = 0
  queued.length = 0
  lastInspected = []
  failQueueOn = null
  for (const id of [userId, otherUserId]) await redis.del(importSlotsKey(id), importWaitingKey(id), `import:inspecting:${id}`)
  const rl = await redis.keys("arciin:rl:*import*")
  if (rl.length) await redis.del(...rl)
  await prisma.job.deleteMany()
  await prisma.uploadSession.deleteMany()
})

describe("POST /imports — scheme-less links", () => {
  it("accepts example.com/video and imports https://example.com/video", async () => {
    const res = await post("/imports", { url: "example.com/video" })
    expect(res.statusCode, res.body).toBe(202)
    expect(queued[0]?.url).toBe("https://example.com/video")
    const job = await prisma.job.findFirstOrThrow()
    expect((job.payload as { url: string }).url).toBe("https://example.com/video")
  })

  it("leaves a full https link as it is", async () => {
    await post("/imports", { url: `${PUB}/file.mp4` })
    expect(queued[0]?.url).toBe(`${PUB}/file.mp4`)
  })

  it.each([
    ["localhost:3000", "IMPORT_URL_BLOCKED"],
    ["127.0.0.1/admin", "IMPORT_URL_BLOCKED"],
    ["http://192.168.1.10/file.mp4", "IMPORT_URL_BLOCKED"],
    ["169.254.169.254/latest", "IMPORT_URL_BLOCKED"],
    ["http://[::1]/", "IMPORT_URL_BLOCKED"],
    ["javascript:alert(1)", "VALIDATION_ERROR"],
    ["file:///etc/passwd", "VALIDATION_ERROR"],
    ["https://user:pw@example.com/", "VALIDATION_ERROR"],
    ["not a link", "VALIDATION_ERROR"],
  ])("%s is refused (%s)", async (url, code) => {
    const res = await post("/imports", { url })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(code)
    expect(queued).toHaveLength(0)
    expect(await prisma.uploadSession.count()).toBe(0)
  })

  it("a fourth concurrent import is refused, and leaves nothing behind", async () => {
    for (let i = 0; i < IMPORT_MAX_ACTIVE_PER_USER; i++) {
      expect((await post("/imports", { url: `${PUB}/f${i}.mp4` })).statusCode).toBe(202)
    }
    const res = await post("/imports", { url: `${PUB}/f9.mp4` })
    expect(res.statusCode).toBe(429)
    expect(await prisma.uploadSession.count()).toBe(IMPORT_MAX_ACTIVE_PER_USER)
  })
})

describe("POST /imports/inspect", () => {
  it("returns at most five candidates with opaque ids, and keeps the URLs server-side", async () => {
    stubInspection({ kind: "collection", title: "Clips", reason: null, items: [1, 2, 3, 4, 5, 6].map(video) })
    const res = await post("/imports/inspect", { url: "93.184.215.14/videos" })
    expect(res.statusCode, res.body).toBe(200)
    const data = res.json().data
    expect(lastInspected).toEqual([`${PUB}/videos`])
    expect(data).toMatchObject({ url: `${PUB}/videos`, kind: "collection", title: "Clips" })
    expect(data.items.map((i: { id: string }) => i.id)).toEqual(["c1", "c2", "c3", "c4", "c5"])
    expect(Object.keys(data.items[0]).sort()).toEqual(["category", "durationSeconds", "hasThumbnail", "id", "source", "title", "url"])
    const stored = JSON.parse((await redis.get(`import:inspect:${data.inspectionId}`))!)
    expect(stored.userId).toBe(userId)
    expect(stored.items).toHaveLength(5)
    expect(await redis.ttl(`import:inspect:${data.inspectionId}`)).toBeGreaterThan(0)
  })

  it.each(["127.0.0.1", "localhost", "10.0.0.1/page", "169.254.169.254", "http://[fe80::1]/"])(
    "refuses %s before any inspection runs",
    async (url) => {
      stubInspection({ kind: "none", title: null, reason: null, items: [] })
      const res = await post("/imports/inspect", { url })
      expect(res.statusCode).toBe(400)
      expect(lastInspected).toEqual([])
    },
  )

  it("reports a DRM host as blocked", async () => {
    stubInspection({ kind: "blocked", title: null, reason: "Spotify is DRM-protected and cannot be downloaded.", items: [] })
    const data = (await post("/imports/inspect", { url: `${PUB}/track` })).json().data
    expect(data).toMatchObject({ kind: "blocked", reason: expect.stringMatching(/Spotify/) })
  })

  it("an inspection that fails or times out is a clear error, not a hang", async () => {
    runner.run = async () => {
      throw new Error("worker exploded")
    }
    const res = await post("/imports/inspect", { url: `${PUB}/page` })
    expect(res.statusCode).toBe(502)
    expect(res.json().error.message).toBe("Could not inspect this link.")
  })

  it("requires a signed-in user", async () => {
    const res = await app.inject({ method: "POST", url: "/api/imports/inspect", payload: { url: `${PUB}/x` } })
    expect(res.statusCode).toBe(401)
  })
})

async function inspectFive() {
  stubInspection({
    kind: "collection",
    title: "Mixed",
    reason: null,
    items: [video(1), video(2), video(3), video(4), { ...video(5), url: `${PUB}/p/photo.jpg`, category: "image" }],
  })
  return (await post("/imports/inspect", { url: `${PUB}/gallery` })).json().data as { inspectionId: string }
}

describe("POST /imports/batch", () => {
  it("imports one selected item", async () => {
    const { inspectionId } = await inspectFive()
    const res = await post("/imports/batch", { inspectionId, itemIds: ["c2"], videoFormat: "mp4" })
    expect(res.statusCode, res.body).toBe(202)
    expect(res.json().data.accepted).toHaveLength(1)
    expect(queued.map((q) => q.url)).toEqual([`${PUB}/clips/v2.mp4`])
  })

  it("all five: three start, two wait on the server — every one is accepted and announced", async () => {
    const { inspectionId } = await inspectFive()
    const res = await post("/imports/batch", { inspectionId, itemIds: ["c1", "c2", "c3", "c4", "c5"], audioOnly: true, audioFormat: "mp3" })
    expect(res.statusCode, res.body).toBe(202)
    const { accepted, rejected } = res.json().data
    expect(rejected).toEqual([])
    expect(accepted.map((a: { state: string }) => a.state)).toEqual(["started", "started", "started", "waiting", "waiting"])
    expect(queued).toHaveLength(IMPORT_MAX_ACTIVE_PER_USER)
    expect(await redis.llen(importWaitingKey(userId))).toBe(2)
    expect(await redis.zcard(importSlotsKey(userId))).toBe(IMPORT_MAX_ACTIVE_PER_USER)
    expect(await prisma.uploadSession.count()).toBe(5)
    // The upload queue hears about all five, waiting ones included.
    const started = events.filter((e) => e.type === "upload.started")
    expect(started).toHaveLength(5)
    expect(started.filter((e) => (e.data as { waiting?: boolean }).waiting)).toHaveLength(2)
  })

  it("one format for the batch: conversions apply to the videos, other items import as they are", async () => {
    const { inspectionId } = await inspectFive()
    await post("/imports/batch", { inspectionId, itemIds: ["c1", "c5"], audioOnly: true, audioFormat: "m4a" })
    const byUrl = Object.fromEntries(queued.map((q) => [String(q.url), q]))
    expect(byUrl[`${PUB}/clips/v1.mp4`]).toMatchObject({ audioOnly: true, audioFormat: "m4a" })
    expect(byUrl[`${PUB}/p/photo.jpg`]).toMatchObject({ audioOnly: undefined, audioFormat: undefined, videoFormat: undefined })
  })

  it("as slots free, the worker starts the waiting ones in order — never more than three at once", async () => {
    const { inspectionId } = await inspectFive()
    await post("/imports/batch", { inspectionId, itemIds: ["c1", "c2", "c3", "c4", "c5"] })
    const running = [...queued]
    const started: Array<{ url: string }> = []
    const enqueue = async (p: { uploadId: string; url: string }) => {
      started.push(p)
    }
    // Nothing can start while three run.
    expect(await promoteWaitingImports(redis, userId, enqueue)).toBe(0)
    await releaseImportSlot(redis, userId, String(running[0]!.uploadId))
    await releaseImportSlot(redis, userId, String(running[0]!.uploadId)) // twice: frees nothing more
    expect(await promoteWaitingImports(redis, userId, enqueue)).toBe(1)
    expect(await redis.zcard(importSlotsKey(userId))).toBe(3)
    await releaseImportSlot(redis, userId, String(running[1]!.uploadId))
    expect(await promoteWaitingImports(redis, userId, enqueue)).toBe(1)
    expect(started.map((s) => s.url)).toEqual([`${PUB}/clips/v4.mp4`, `${PUB}/p/photo.jpg`])
    expect(await redis.llen(importWaitingKey(userId))).toBe(0)
  })

  it("a waiting import that cannot be queued goes back to the front, and its slot is released", async () => {
    await redis.rpush(importWaitingKey(userId), JSON.stringify({ uploadId: "u-waiting", url: `${PUB}/a.mp4` }))
    await expect(
      promoteWaitingImports(redis, userId, async () => {
        throw new Error("queue down")
      }),
    ).rejects.toThrow()
    expect(await redis.llen(importWaitingKey(userId))).toBe(1)
    expect(await redis.zscore(importSlotsKey(userId), "u-waiting")).toBeNull()
  })

  it("one item failing does not stop the others", async () => {
    const { inspectionId } = await inspectFive()
    failQueueOn = "v2.mp4"
    const res = await post("/imports/batch", { inspectionId, itemIds: ["c1", "c2", "c3"] })
    expect(res.statusCode).toBe(202)
    const { accepted, rejected } = res.json().data
    expect(accepted.map((a: { itemId: string }) => a.itemId)).toEqual(["c1", "c3"])
    expect(rejected.map((r: { itemId: string }) => r.itemId)).toEqual(["c2"])
    // The failed item's slot was given back.
    expect(await redis.zcard(importSlotsKey(userId))).toBe(2)
  })

  it("imports only what the server found — a client cannot name its own URL", async () => {
    const { inspectionId } = await inspectFive()
    const res = await post("/imports/batch", {
      inspectionId,
      itemIds: ["c1"],
      url: "http://127.0.0.1/secret",
      items: [{ id: "c1", url: "http://127.0.0.1/secret" }],
    })
    expect(res.statusCode).toBe(202)
    expect(queued.map((q) => q.url)).toEqual([`${PUB}/clips/v1.mp4`])
  })

  it("re-checks every stored URL at import time", async () => {
    // As if DNS or a tampered store now pointed an item inward.
    const id = "tampered-inspection-0000"
    await redis.set(
      `import:inspect:${id}`,
      JSON.stringify({
        userId,
        url: `${PUB}/page`,
        items: [
          { id: "c1", url: "http://127.0.0.1/secret", category: "video" },
          { id: "c2", url: "http://169.254.169.254/latest/meta-data", category: "file" },
          { id: "c3", url: `${PUB}/ok.mp4`, category: "video" },
        ],
      }),
      "EX",
      60,
    )
    const res = await post("/imports/batch", { inspectionId: id, itemIds: ["c1", "c2", "c3"] })
    expect(res.statusCode).toBe(202)
    const { accepted, rejected } = res.json().data
    expect(accepted.map((a: { itemId: string }) => a.itemId)).toEqual(["c3"])
    expect(rejected.map((r: { itemId: string }) => r.itemId)).toEqual(["c1", "c2"])
    expect(queued.map((q) => q.url)).toEqual([`${PUB}/ok.mp4`])
  })

  it("another user's inspection is not found; unknown items and more than five are refused", async () => {
    const { inspectionId } = await inspectFive()
    expect((await post("/imports/batch", { inspectionId, itemIds: ["c1"] }, otherCookie)).statusCode).toBe(404)
    expect((await post("/imports/batch", { inspectionId, itemIds: ["c9"] })).statusCode).toBe(400)
    expect((await post("/imports/batch", { inspectionId, itemIds: ["c1", "c2", "c3", "c4", "c5", "c6"] })).statusCode).toBe(400)
    expect(queued).toHaveLength(0)
  })

  it("the waiting line is bounded", async () => {
    for (let i = 0; i < 9; i++) await redis.rpush(importWaitingKey(userId), JSON.stringify({ uploadId: `w${i}` }))
    const { inspectionId } = await inspectFive()
    const res = await post("/imports/batch", { inspectionId, itemIds: ["c1", "c2"] })
    expect(res.statusCode).toBe(429)
  })
})

describe("slots", () => {
  it("are atomic and idempotent per upload", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => acquireImportSlot(redis, userId, `u${i}`)),
    )
    expect(results.filter(Boolean)).toHaveLength(IMPORT_MAX_ACTIVE_PER_USER)
    const holder = (await redis.zrange(importSlotsKey(userId), 0, 0))[0]!
    expect(await acquireImportSlot(redis, userId, holder)).toBe(true) // already held
    expect(await redis.zcard(importSlotsKey(userId))).toBe(IMPORT_MAX_ACTIVE_PER_USER)
  })

  it("a slot abandoned for hours is reclaimed", async () => {
    await redis.zadd(importSlotsKey(userId), Date.now() - 3 * 60 * 60 * 1000, "dead-1")
    await redis.zadd(importSlotsKey(userId), Date.now(), "live-1")
    await redis.zadd(importSlotsKey(userId), Date.now(), "live-2")
    expect(await acquireImportSlot(redis, userId, "new")).toBe(true)
    expect(await redis.zscore(importSlotsKey(userId), "dead-1")).toBeNull()
  })
})


describe("source titles — decided by the server", () => {
  it("a batch import carries the title the server stored, never one the client sends", async () => {
    stubInspection({
      kind: "collection",
      title: "Playlist",
      reason: null,
      items: [{ ...video(1), title: "Building a Data Center — Redundancy Explained" }, video(2)],
    })
    const { inspectionId } = (await post("/imports/inspect", { url: `${PUB}/playlist` })).json().data
    const res = await post("/imports/batch", { inspectionId, itemIds: ["c1"], title: "client says hi", sourceTitle: "evil" })
    expect(res.statusCode, res.body).toBe(202)
    expect(queued[0]).toMatchObject({ url: `${PUB}/clips/v1.mp4`, sourceTitle: "Building a Data Center — Redundancy Explained" })
    const job = await prisma.job.findFirstOrThrow()
    expect((job.payload as { sourceTitle?: string }).sourceTitle).toBe("Building a Data Center — Redundancy Explained")
    const session = await prisma.uploadSession.findFirstOrThrow()
    expect(session.originalFilename).toBe("Building a Data Center — Redundancy Explained")
  })

  it("a candidate with no source title sends none (no 'Item 1' placeholder)", async () => {
    stubInspection({ kind: "collection", title: null, reason: null, items: [{ ...video(1), title: null }, video(2)] })
    const { inspectionId } = (await post("/imports/inspect", { url: `${PUB}/untitled` })).json().data
    await post("/imports/batch", { inspectionId, itemIds: ["c1"] })
    expect(queued[0]).not.toHaveProperty("sourceTitle")
  })

  it("a single import names its candidate by id; the server checks it is the same link and the same user", async () => {
    stubInspection({ kind: "single", title: null, reason: null, items: [{ ...video(7), url: `${PUB}/watch/7`, title: "My Podcast Episode" }] })
    const { inspectionId } = (await post("/imports/inspect", { url: `${PUB}/watch/7` })).json().data

    await post("/imports", { url: `${PUB}/watch/7`, inspectionId, itemId: "c1", audioOnly: true, audioFormat: "mp3" })
    expect(queued.at(-1)).toMatchObject({ sourceTitle: "My Podcast Episode", audioOnly: true })

    // A different link with the same reference gets no title.
    await redis.del(importSlotsKey(userId))
    await post("/imports", { url: `${PUB}/watch/8`, inspectionId, itemId: "c1" })
    expect(queued.at(-1)).not.toHaveProperty("sourceTitle")

    // Someone else's inspection gives nothing.
    await post("/imports", { url: `${PUB}/watch/7`, inspectionId, itemId: "c1" }, otherCookie)
    expect(queued.at(-1)).not.toHaveProperty("sourceTitle")

    // A title in the body is not a field the server reads.
    await redis.del(importSlotsKey(userId))
    await post("/imports", { url: `${PUB}/watch/9`, title: "client title", sourceTitle: "client title" })
    expect(queued.at(-1)).not.toHaveProperty("sourceTitle")
  })
})

describe("GET /imports/inspections/:id/items/:item/thumbnail", () => {
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex")
  let fetched: string[] = []

  beforeEach(() => {
    fetched = []
    thumbCache.clear()
    thumbs.fetch = async (url: string) => {
      fetched.push(url)
      return { ok: true, body: PNG, contentType: "image/png" }
    }
  })

  async function inspectWithThumbs() {
    stubInspection({
      kind: "collection",
      title: "Thumbs",
      reason: null,
      items: [
        { ...video(1), thumbnail: "https://i.ytimg.example/vi/one/hq.jpg" },
        { ...video(2), thumbnail: null },
      ],
    })
    const res = await post("/imports/inspect", { url: `${PUB}/thumbs` })
    return res.json().data as { inspectionId: string; items: Array<Record<string, unknown>> }
  }
  const get = (url: string, c: string | null = cookie) =>
    app.inject({ method: "GET", url: `/api${url}`, headers: c ? { cookie: c } : {} })

  it("the inspection response never carries the third-party URL", async () => {
    const data = await inspectWithThumbs()
    expect(JSON.stringify(data)).not.toContain("ytimg")
    expect(data.items.map((i) => i.hasThumbnail)).toEqual([true, false])
  })

  it("serves the image same-origin, from the stored URL, with safe headers — and caches it", async () => {
    const { inspectionId } = await inspectWithThumbs()
    const res = await get(`/imports/inspections/${inspectionId}/items/c1/thumbnail`)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.headers["content-type"]).toBe("image/png")
    expect(res.headers["x-content-type-options"]).toBe("nosniff")
    expect(res.headers["cache-control"]).toBe("private, max-age=600")
    expect(res.rawPayload.equals(PNG)).toBe(true)
    expect(fetched).toEqual(["https://i.ytimg.example/vi/one/hq.jpg"])
    await get(`/imports/inspections/${inspectionId}/items/c1/thumbnail`)
    expect(fetched).toHaveLength(1)
  })

  it("no thumbnail, an unknown item, a malformed id: 404 without fetching", async () => {
    const { inspectionId } = await inspectWithThumbs()
    for (const path of [
      `/imports/inspections/${inspectionId}/items/c2/thumbnail`,
      `/imports/inspections/${inspectionId}/items/c9/thumbnail`,
      `/imports/inspections/${inspectionId}/items/..%2F..%2Fx/thumbnail`,
      `/imports/inspections/short/items/c1/thumbnail`,
    ]) {
      expect((await get(path)).statusCode, path).toBe(404)
    }
    expect(fetched).toEqual([])
  })

  it("another user's or an expired inspection is not found; signed-out is refused", async () => {
    const { inspectionId } = await inspectWithThumbs()
    expect((await get(`/imports/inspections/${inspectionId}/items/c1/thumbnail`, otherCookie)).statusCode).toBe(404)
    expect((await get(`/imports/inspections/${inspectionId}/items/c1/thumbnail`, null)).statusCode).toBe(401)
    await redis.del(`import:inspect:${inspectionId}`)
    expect((await get(`/imports/inspections/${inspectionId}/items/c1/thumbnail`)).statusCode).toBe(404)
    expect(fetched).toEqual([])
  })

  it("a fetch the proxy refuses (private address, not an image, too large) is a 404, and not retried each time", async () => {
    thumbs.fetch = async (url: string) => {
      fetched.push(url)
      return { ok: false, reason: "blocked" }
    }
    const { inspectionId } = await inspectWithThumbs()
    expect((await get(`/imports/inspections/${inspectionId}/items/c1/thumbnail`)).statusCode).toBe(404)
    expect((await get(`/imports/inspections/${inspectionId}/items/c1/thumbnail`)).statusCode).toBe(404)
    expect(fetched).toHaveLength(1)
  })
})
