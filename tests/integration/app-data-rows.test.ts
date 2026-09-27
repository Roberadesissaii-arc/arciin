import Redis from "ioredis"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { hashApiKey } from "../../apps/api/src/services/security/auth"
import { invalidateApiProtectionCache } from "../../apps/api/src/services/security/instance-security"
import {
  createTestStorageRoot,
  grantTestLicense,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

/**
 * App Data rows over HTTP, the way an external app drives them.
 *
 * The restaurant integration that found the PATCH data loss is reproduced
 * exactly: a menu item with a price, a category, and an image reference
 * pointing at an uploaded asset; then a PATCH that changes only the price.
 */

let fixtures: Fixtures
let redis: Redis
let key: string
let app: Awaited<ReturnType<typeof buildApp>>

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerErrorHandler } = await import("../../apps/api/src/plugins/error-handler")
  const { registerJsonBodyParser } = await import("../../apps/api/src/plugins/json-body")
  const { registerAppDatabaseRoutes } = await import("../../apps/api/src/modules/app-databases/routes")
  const a = Fastify({ logger: false })
  a.decorate("prisma", prisma)
  a.decorate("redis", redis)
  a.decorate("publishRealtimeEvent", async () => {})
  registerJsonBodyParser(a)
  await registerErrorHandler(a)
  await registerCookies(a)
  await a.register(async (api) => registerAppDatabaseRoutes(api), { prefix: "/api" })
  await a.ready()
  return a
}

const auth = () => ({ authorization: `Bearer ${key}` })

beforeAll(async () => {
  await resetDatabase()
  fixtures = await seedBaseFixtures(await createTestStorageRoot())
  redis = new Redis(process.env.REDIS_URL!)
  await grantTestLicense(fixtures.storageLocation.rootPath)
  invalidateApiProtectionCache()
  key = `arc_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`
  await prisma.apiKey.create({
    data: {
      userId: fixtures.user.id,
      name: "restaurant",
      keyHash: hashApiKey(key),
      keyPrefix: key.slice(0, 12),
      scopes: [
        "appdata:databases:read", "appdata:databases:write", "appdata:databases:delete",
        "appdata:folders:read", "appdata:folders:write", "appdata:folders:delete",
        "appdata:records:read", "appdata:records:write", "appdata:records:delete",
      ],
      rateLimitPerMinute: 100_000,
    },
  })
  app = await buildApp()
})

afterAll(async () => {
  await app?.close()
  await prisma.appDatabaseRecord.deleteMany()
  await prisma.appDatabaseFolder.deleteMany()
  await prisma.appDatabase.deleteMany()
  await prisma.apiKey.deleteMany()
  await prisma.instanceConfig.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await redis.quit()
  await prisma.$disconnect()
})

let tableId: string

beforeEach(async () => {
  await prisma.appDatabaseRecord.deleteMany()
  await prisma.appDatabaseFolder.deleteMany()
  await prisma.appDatabase.deleteMany()
  const db = await app.inject({ method: "POST", url: "/api/app-databases", headers: auth(), payload: { name: "Menu" } })
  expect(db.statusCode).toBe(201)
  const table = await app.inject({
    method: "POST",
    url: `/api/app-databases/${db.json().data.id}/tables`,
    headers: auth(),
    payload: { name: "items" },
  })
  expect(table.statusCode).toBe(201)
  tableId = table.json().data.id
})

const margherita = {
  price: 12.99,
  category: "pizza",
  image: {
    assetId: "asset_menu_1",
    title: "Margherita",
    downloadUrl: "/api/assets/asset_menu_1/download",
  },
}

async function createRow(name = "margherita", payload: Record<string, unknown> = margherita) {
  const res = await app.inject({
    method: "POST",
    url: `/api/app-database-tables/${tableId}/rows`,
    headers: auth(),
    payload: { name, payload },
  })
  expect(res.statusCode).toBe(201)
  return res.json().data as { id: string; name: string; payload: Record<string, unknown> }
}

async function patch(id: string, body: unknown) {
  return app.inject({ method: "PATCH", url: `/api/app-database-rows/${id}`, headers: auth(), payload: body as object })
}

describe("PATCH merges", () => {
  it("restaurant regression: change only the price — category and image survive", async () => {
    const row = await createRow()
    const res = await patch(row.id, { payload: { price: 13.99 } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.payload).toEqual({ ...margherita, price: 13.99 })
    // And it is what is stored, not just what was echoed.
    const stored = await prisma.appDatabaseRecord.findUniqueOrThrow({ where: { id: row.id } })
    expect(stored.payload).toEqual({ ...margherita, price: 13.99 })
  })

  it("name-only PATCH leaves the payload untouched", async () => {
    const row = await createRow()
    const res = await patch(row.id, { name: "margherita-large" })
    expect(res.json().data.name).toBe("margherita-large")
    expect(res.json().data.payload).toEqual(margherita)
  })

  it("payload-only PATCH leaves the name untouched", async () => {
    const row = await createRow()
    const res = await patch(row.id, { payload: { category: "classic" } })
    expect(res.json().data.name).toBe("margherita")
    expect(res.json().data.payload.category).toBe("classic")
    expect(res.json().data.payload.image).toEqual(margherita.image)
  })

  it("empty PATCH is a no-op, not an error and not a wipe", async () => {
    const row = await createRow()
    const res = await patch(row.id, {})
    expect(res.statusCode).toBe(200)
    expect(res.json().data.payload).toEqual(margherita)
    expect(res.json().data.name).toBe("margherita")
  })

  it("nested image title PATCH keeps assetId and downloadUrl", async () => {
    const row = await createRow()
    const res = await patch(row.id, { payload: { image: { title: "Margherita (new photo)" } } })
    expect(res.json().data.payload.image).toEqual({ ...margherita.image, title: "Margherita (new photo)" })
    expect(res.json().data.payload.price).toBe(12.99)
  })

  it("explicit null is stored", async () => {
    const row = await createRow()
    const res = await patch(row.id, { payload: { image: null } })
    expect(res.json().data.payload.image).toBeNull()
    expect(res.json().data.payload.category).toBe("pizza")
  })

  it("concurrent partial updates both land", async () => {
    const row = await createRow()
    const results = await Promise.all([
      patch(row.id, { payload: { price: 14.5 } }),
      patch(row.id, { payload: { category: "special" } }),
      patch(row.id, { payload: { image: { title: "Concurrent" } } }),
    ])
    for (const r of results) expect(r.statusCode).toBe(200)
    const stored = (await prisma.appDatabaseRecord.findUniqueOrThrow({ where: { id: row.id } })).payload as typeof margherita
    expect(stored.price).toBe(14.5)
    expect(stored.category).toBe("special")
    expect(stored.image).toEqual({ ...margherita.image, title: "Concurrent" })
  })

  it("unknown row is a JSON 404", async () => {
    const res = await patch("does-not-exist", { payload: { price: 1 } })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("NOT_FOUND")
  })

  it("a non-object payload is a validation error", async () => {
    const row = await createRow()
    const res = await patch(row.id, { payload: [1, 2] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("VALIDATION_ERROR")
  })
})

describe("PUT replaces", () => {
  it("replaces the whole payload, which is how a key is removed", async () => {
    const row = await createRow()
    const res = await app.inject({
      method: "PUT",
      url: `/api/app-database-rows/${row.id}`,
      headers: auth(),
      payload: { payload: { price: 9 } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.payload).toEqual({ price: 9 })
  })

  it("requires the payload", async () => {
    const row = await createRow()
    const res = await app.inject({
      method: "PUT",
      url: `/api/app-database-rows/${row.id}`,
      headers: auth(),
      payload: { name: "x" },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe("create endpoints answer 201", () => {
  it("database, table, and row", async () => {
    // Database and table 201s are asserted in beforeEach; the row here.
    const res = await app.inject({
      method: "POST",
      url: `/api/app-database-tables/${tableId}/rows`,
      headers: auth(),
      payload: { name: "calzone", payload: { price: 11 } },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.id).toBeTruthy()
  })
})
