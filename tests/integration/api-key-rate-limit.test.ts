import Redis from "ioredis"

import {
  buildHostedTokenPayload,
  parseLicensePrivateKey,
  signHostedLicenseToken,
} from "@arciin/config"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  DEFAULT_API_KEY_RATE_LIMIT_PER_MINUTE,
  resolveEffectiveKeyLimit,
} from "../../apps/api/src/services/security/api-key-rate-limit"
import { authenticateFlexible, hashApiKey, hashToken } from "../../apps/api/src/services/security/auth"
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
 * Per-key rate limits, through the real authentication path and real Redis.
 *
 * New keys carry a limit. Keys from before v1.1.0 (null limit) are left alone
 * unless the owner set an instance-wide limit, because silently throttling an
 * integration someone already depends on is its own kind of outage.
 */

let fixtures: Fixtures
let redis: Redis

beforeAll(async () => {
  await resetDatabase()
  fixtures = await seedBaseFixtures(await createTestStorageRoot())
  redis = new Redis(process.env.REDIS_URL!)
})

afterAll(async () => {
  await prisma.apiKey.deleteMany()
  await prisma.instanceConfig.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await redis.quit()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.apiKey.deleteMany()
  await prisma.instanceConfig.deleteMany()
  const keys = await redis.keys("arciin:rpm:key:*")
  if (keys.length) await redis.del(...keys)
  invalidateApiProtectionCache()
})

async function setInstanceLimit(perMinute: number) {
  await prisma.instanceConfig.deleteMany()
  await prisma.instanceConfig.create({
    data: {
      instanceName: "Rate",
      storageRoot: fixtures.storageLocation.rootPath,
      initializedAt: new Date(),
      licensePlan: "free",
      licenseStatus: "none",
      remoteAccessConfig: { security: { apiKeyRequestsPerMinute: perMinute } },
    },
  })
  // Settings are cached for a few seconds in the API; a test changes them
  // faster than that.
  invalidateApiProtectionCache()
}

async function createKey(rateLimitPerMinute: number | null) {
  const raw = `arc_${crypto.randomUUID().replace(/-/g, "")}`
  const row = await prisma.apiKey.create({
    data: {
      userId: fixtures.user.id,
      name: "rate",
      keyHash: hashApiKey(raw),
      keyPrefix: raw.slice(0, 12),
      scopes: ["assets:read"],
      rateLimitPerMinute,
    },
  })
  return { raw, id: row.id }
}

type Captured = { status: number | null; body: unknown; headers: Record<string, string | number> }

function call(raw: string, redisClient: unknown = redis) {
  const captured: Captured = { status: null, body: null, headers: {} }
  const request = {
    headers: { authorization: `Bearer ${raw}` },
    cookies: {},
    ip: "127.0.0.1",
    url: "/api/assets",
    socket: { remoteAddress: "127.0.0.1" },
    server: { prisma, redis: redisClient },
    auth: undefined,
  } as never
  const reply = {
    status(code: number) {
      captured.status = code
      return this
    },
    send(body: unknown) {
      captured.body = body
      return this
    },
    header(name: string, value: string | number) {
      captured.headers[name] = value
      return this
    },
  } as never
  return authenticateFlexible(request, reply).then(() => ({
    captured,
    authed: Boolean((request as { auth?: unknown }).auth),
  }))
}

describe("resolveEffectiveKeyLimit", () => {
  it("takes the stricter of key and instance limits", () => {
    expect(resolveEffectiveKeyLimit(600, 0)).toBe(600)
    expect(resolveEffectiveKeyLimit(600, 100)).toBe(100)
    expect(resolveEffectiveKeyLimit(50, 100)).toBe(50)
  })

  it("grandfathered keys are unlimited unless the instance sets a limit", () => {
    expect(resolveEffectiveKeyLimit(null, 0)).toBeNull()
    expect(resolveEffectiveKeyLimit(undefined, 0)).toBeNull()
    expect(resolveEffectiveKeyLimit(null, 30)).toBe(30)
  })
})

describe("per-key rate limit", () => {
  it("the default for new keys is a sensible baseline", () => {
    expect(DEFAULT_API_KEY_RATE_LIMIT_PER_MINUTE).toBe(600)
  })

  it("allows up to the limit, then answers 429 with the JSON envelope", async () => {
    const { raw } = await createKey(3)
    for (let i = 0; i < 3; i++) {
      const { authed, captured } = await call(raw)
      expect(authed).toBe(true)
      expect(captured.status).toBeNull()
      expect(captured.headers["X-RateLimit-Limit"]).toBe(3)
      expect(captured.headers["X-RateLimit-Remaining"]).toBe(2 - i)
    }
    const { authed, captured } = await call(raw)
    expect(authed).toBe(false)
    expect(captured.status).toBe(429)
    expect(captured.body).toMatchObject({
      error: { code: "RATE_LIMITED", details: { limit: 3 } },
    })
    expect(Number(captured.headers["Retry-After"])).toBeGreaterThanOrEqual(1)
    expect(Number(captured.headers["Retry-After"])).toBeLessThanOrEqual(60)
  })

  it("limits are per key: one noisy key does not throttle another", async () => {
    const noisy = await createKey(1)
    const quiet = await createKey(1)
    await call(noisy.raw)
    expect((await call(noisy.raw)).captured.status).toBe(429)
    expect((await call(quiet.raw)).authed).toBe(true)
  })

  it("a grandfathered key is not limited when the instance sets no limit", async () => {
    const { raw } = await createKey(null)
    for (let i = 0; i < 25; i++) {
      expect((await call(raw)).authed).toBe(true)
    }
  })

  it("the instance limit still applies to grandfathered keys, and caps new ones", async () => {
    await setInstanceLimit(2)
    const legacy = await createKey(null)
    const modern = await createKey(600)
    for (const key of [legacy, modern]) {
      expect((await call(key.raw)).authed).toBe(true)
      expect((await call(key.raw)).authed).toBe(true)
      expect((await call(key.raw)).captured.status).toBe(429)
    }
  })

  it("a Redis outage does not turn valid keys into 500s", async () => {
    const { raw } = await createKey(1)
    const broken = {
      multi: () => ({ incr: () => ({ expire: () => ({ exec: async () => { throw new Error("redis down") } }) }) }),
    }
    const { authed, captured } = await call(raw, broken)
    expect(authed).toBe(true)
    expect(captured.status).toBeNull()
  })

  it("session cookies are never counted against a key limit", async () => {
    const raw = `sess_${crypto.randomUUID()}`
    await prisma.session.create({
      data: { userId: fixtures.user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) },
    })
    expect(await redis.keys("arciin:rpm:key:*")).toEqual([])
  })
})

describe("the create route gives new keys the baseline", () => {
  it("POST /api-keys stores rateLimitPerMinute and returns it; omitted → default", async () => {
    const Fastify = (await import("fastify")).default
    const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
    const { registerApiKeyRoutes } = await import("../../apps/api/src/modules/api-keys/routes")
    const app = Fastify({ logger: false })
    app.decorate("prisma", prisma)
    app.decorate("redis", redis)
    app.decorate("publishRealtimeEvent", async () => {})
    await registerCookies(app)
    await app.register(async (api) => registerApiKeyRoutes(api), { prefix: "/api" })
    await app.ready()
    // developer.api_keys is a paid feature. Sign a licence with the suite's
    // throwaway vendor key so the route itself — not the gate — is under test.
    const instance = await prisma.instanceConfig.create({
      data: {
        instanceName: "Rate",
        storageRoot: fixtures.storageLocation.rootPath,
        initializedAt: new Date(),
        licensePlan: "free",
        licenseStatus: "none",
      },
    })
    const expiresAt = new Date(Date.now() + 31 * 86_400_000)
    const graceUntil = new Date(Date.now() + 38 * 86_400_000)
    await prisma.instanceConfig.update({
      where: { id: instance.id },
      data: {
        licensePlan: "business",
        licenseStatus: "active",
        licenseKeyPrefix: "ARC_TST…0001",
        licenseActivatedAt: new Date(),
        licenseExpiresAt: expiresAt,
        licenseGraceUntil: graceUntil,
        licenseSource: "hosted",
        licenseSignedToken: signHostedLicenseToken(
          buildHostedTokenPayload({
            licenseId: "lic_rate",
            plan: "business",
            status: "active",
            instanceId: instance.id,
            serverLimit: 1,
            keyPrefix: "ARC_TST…0001",
            expiresAt,
            graceUntil,
          }),
          parseLicensePrivateKey("P1L5nJPd7wq0kUwqhU7SbXe0P4H2fT1YtGxWvBoNsRA"),
          "arciin-lic-test",
        ),
      },
    })
    const raw = `sess_${crypto.randomUUID()}`
    await prisma.session.create({
      data: { userId: fixtures.user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) },
    })
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/api-keys",
        headers: { cookie: `arciin_session=${raw}` },
        payload: { name: "restaurant", scopes: ["assets:read"] },
      })
      expect(res.statusCode).toBe(201)
      expect(res.json().data.apiKey.rateLimitPerMinute).toBe(DEFAULT_API_KEY_RATE_LIMIT_PER_MINUTE)
      const custom = await app.inject({
        method: "POST",
        url: "/api/api-keys",
        headers: { cookie: `arciin_session=${raw}` },
        payload: { name: "bulk", scopes: ["assets:read"], rateLimitPerMinute: 120 },
      })
      expect(custom.json().data.apiKey.rateLimitPerMinute).toBe(120)
      const bad = await app.inject({
        method: "POST",
        url: "/api/api-keys",
        headers: { cookie: `arciin_session=${raw}` },
        payload: { name: "bad", scopes: ["assets:read"], rateLimitPerMinute: 0 },
      })
      expect(bad.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })
})
