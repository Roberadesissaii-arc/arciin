import Redis from "ioredis"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { hashApiKey } from "../../apps/api/src/services/security/auth"
import { invalidateApiProtectionCache } from "../../apps/api/src/services/security/instance-security"
import {
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

/**
 * Every refusal is a JSON envelope with the right status.
 *
 *   401  no credential, malformed, unknown, revoked, or expired key
 *   403  a valid key that lacks the scope for this route
 *
 * An external integration reported "403 with an empty body". The API guard
 * was already correct; the body was being lost in the web proxy (see
 * tests/api-proxy-envelope.test.ts). This pins the API half so it stays right,
 * and proves the handler never runs after a guard has answered.
 */

let fixtures: Fixtures
let redis: Redis
let handlerRuns = 0

const keys: Record<string, string> = {}

async function makeKey(label: string, data: { scopes: string[]; revokedAt?: Date; expiresAt?: Date }) {
  const raw = `arc_${label}_${crypto.randomUUID().replace(/-/g, "")}`
  await prisma.apiKey.create({
    data: {
      userId: fixtures.user.id,
      name: label,
      keyHash: hashApiKey(raw),
      keyPrefix: raw.slice(0, 12),
      scopes: data.scopes,
      revokedAt: data.revokedAt ?? null,
      expiresAt: data.expiresAt ?? null,
      rateLimitPerMinute: 10_000,
    },
  })
  keys[label] = raw
}

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerErrorHandler } = await import("../../apps/api/src/plugins/error-handler")
  const { registerJsonBodyParser } = await import("../../apps/api/src/plugins/json-body")
  const { registerAppDatabaseRoutes } = await import("../../apps/api/src/modules/app-databases/routes")
  const { requireSessionRolesOrApiKeyScopes } = await import("../../apps/api/src/services/security/auth")
  const app = Fastify({ logger: false })
  app.decorate("prisma", prisma)
  app.decorate("redis", redis)
  app.decorate("publishRealtimeEvent", async () => {})
  registerJsonBodyParser(app)
  await registerErrorHandler(app)
  await registerCookies(app)
  await app.register(
    async (api) => {
      await registerAppDatabaseRoutes(api)
      // A probe route with the same guard shape, counting handler executions.
      api.delete(
        "/probe/:id",
        { preHandler: requireSessionRolesOrApiKeyScopes(["OWNER"], ["assets:write"]) },
        async (_req, reply) => {
          handlerRuns += 1
          reply.send({ data: { ok: true } })
        },
      )
    },
    { prefix: "/api" },
  )
  await app.ready()
  return app
}

let app: Awaited<ReturnType<typeof buildApp>>

beforeAll(async () => {
  await resetDatabase()
  fixtures = await seedBaseFixtures(await createTestStorageRoot())
  redis = new Redis(process.env.REDIS_URL!)
  await prisma.instanceConfig.deleteMany()
  invalidateApiProtectionCache()
  await makeKey("noscope", { scopes: ["assets:read"] })
  await makeKey("revoked", { scopes: ["appdata:databases:read"], revokedAt: new Date() })
  await makeKey("expired", { scopes: ["appdata:databases:read"], expiresAt: new Date(Date.now() - 1000) })
  await makeKey("writer", { scopes: ["assets:write"] })
  app = await buildApp()
})

afterAll(async () => {
  await app?.close()
  await prisma.apiKey.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await redis.quit()
  await prisma.$disconnect()
})

function expectEnvelope(res: { statusCode: number; body: string; headers: Record<string, unknown> }, status: number, code: string) {
  expect(res.statusCode).toBe(status)
  expect(String(res.headers["content-type"])).toContain("application/json")
  expect(res.body.length).toBeGreaterThan(0)
  const parsed = JSON.parse(res.body)
  expect(parsed.error.code).toBe(code)
  expect(typeof parsed.error.message).toBe("string")
}

const APP_DATA_ROUTES: Array<[string, string, unknown]> = [
  ["GET", "/api/app-databases", undefined],
  ["POST", "/api/app-databases", { name: "x" }],
  ["GET", "/api/app-databases/db1", undefined],
  ["DELETE", "/api/app-databases/db1", undefined],
  ["GET", "/api/app-databases/db1/tables", undefined],
  ["POST", "/api/app-databases/db1/tables", { name: "t" }],
  ["PATCH", "/api/app-database-tables/t1", { name: "t" }],
  ["DELETE", "/api/app-database-tables/t1", undefined],
  ["GET", "/api/app-database-tables/t1/rows", undefined],
  ["POST", "/api/app-database-tables/t1/rows", { name: "r", payload: {} }],
  ["PATCH", "/api/app-database-rows/r1", { payload: { price: 1 } }],
  ["DELETE", "/api/app-database-rows/r1", undefined],
]

describe("401 — who are you?", () => {
  it.each([
    ["no credential", undefined],
    ["not a bearer", "Basic abc"],
    ["not an Arciin key", "Bearer sk_live_123"],
    ["unknown key", `Bearer arc_${"0".repeat(48)}`],
  ])("%s", async (_label, authorization) => {
    const res = await app.inject({
      method: "GET",
      url: "/api/app-databases",
      headers: authorization ? { authorization } : {},
    })
    expectEnvelope(res, 401, "UNAUTHENTICATED")
  })

  it("revoked key", async () => {
    const res = await app.inject({ method: "GET", url: "/api/app-databases", headers: { authorization: `Bearer ${keys.revoked}` } })
    expectEnvelope(res, 401, "UNAUTHENTICATED")
  })

  it("expired key", async () => {
    const res = await app.inject({ method: "GET", url: "/api/app-databases", headers: { authorization: `Bearer ${keys.expired}` } })
    expectEnvelope(res, 401, "UNAUTHENTICATED")
  })
})

describe("403 — you, but not this", () => {
  it.each(APP_DATA_ROUTES)("%s %s with a key lacking the scope", async (method, url, payload) => {
    const res = await app.inject({
      method: method as "GET",
      url,
      payload: payload as object | undefined,
      headers: { authorization: `Bearer ${keys.noscope}` },
    })
    expectEnvelope(res, 403, "FORBIDDEN")
  })

  it("the handler never runs after a guard has refused", async () => {
    handlerRuns = 0
    const refused = await app.inject({ method: "DELETE", url: "/api/probe/1", headers: { authorization: `Bearer ${keys.noscope}` } })
    expectEnvelope(refused, 403, "FORBIDDEN")
    expect(handlerRuns).toBe(0)
    const allowed = await app.inject({ method: "DELETE", url: "/api/probe/1", headers: { authorization: `Bearer ${keys.writer}` } })
    expect(allowed.statusCode).toBe(200)
    expect(handlerRuns).toBe(1)
  })
})

describe("JSON bodies", () => {
  it("a DELETE carrying Content-Type: application/json and no body reaches auth", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/probe/1",
      headers: { authorization: `Bearer ${keys.writer}`, "content-type": "application/json" },
    })
    expect(res.statusCode).toBe(200)
  })

  it("an empty JSON body on a route that needs one is a validation error, not a parser crash", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/app-databases",
      headers: { authorization: `Bearer ${keys.noscope}`, "content-type": "application/json" },
    })
    // Auth still answers first — the key lacks the scope.
    expectEnvelope(res, 403, "FORBIDDEN")
  })

  it("prototype poisoning is still refused", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/probe/1",
      headers: { authorization: `Bearer ${keys.writer}`, "content-type": "application/json" },
      payload: '{"__proto__":{"admin":true}}',
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toBeDefined()
  })

  it("malformed JSON is a 400 envelope", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/probe/1",
      headers: { authorization: `Bearer ${keys.writer}`, "content-type": "application/json" },
      payload: "{not json",
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error.code).toBeDefined()
  })
})
