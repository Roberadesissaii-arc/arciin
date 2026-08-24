import Redis from "ioredis"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  authenticateFlexible,
  hashApiKey,
  hashToken,
  requireSessionRole,
  requireSessionRolesOrApiKeyScopes,
  scopeAllows,
  scopeAllowsAny,
} from "../../apps/api/src/services/security/auth"
import { prisma, resetDatabase, seedBaseFixtures, createTestStorageRoot, removeTestStorageRoot, type Fixtures } from "./setup"

/**
 * API key authentication and scope enforcement.
 *
 * An API key is a credential handed to a script, so every one of these is a
 * question about what the *server* does when handed a key it should refuse —
 * revoked, expired, belonging to a disabled user, or simply lacking the scope
 * for the route. A UI never sees any of this.
 *
 * `authenticateFlexible` and `requireSessionRolesOrApiKeyScopes` are called
 * directly, with a request/reply shaped closely enough for them, rather than
 * reimplemented — a reimplementation would keep passing while the real guard
 * regressed.
 */

let fixtures: Fixtures
let redis: Redis

beforeAll(async () => {
  const root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
  redis = new Redis(process.env.REDIS_URL!)
})

afterAll(async () => {
  await resetDatabase()
  await removeTestStorageRoot()
  await redis.quit()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.apiKey.deleteMany()
})

type Captured = { status: number | null; body: unknown }

/** A request/reply pair with just the surface the auth helpers touch. */
function makeRequest(authorization?: string) {
  const captured: Captured = { status: null, body: null }

  const request = {
    headers: authorization ? { authorization } : {},
    cookies: {},
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    server: { prisma, redis },
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
  } as never

  return { request, reply, captured }
}

async function createKey(input: {
  scopes: string[]
  revokedAt?: Date | null
  expiresAt?: Date | null
}) {
  const raw = `arc_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  await prisma.apiKey.create({
    data: {
      userId: fixtures.user.id,
      name: "integration key",
      keyHash: hashApiKey(raw),
      keyPrefix: raw.slice(0, 10),
      scopes: input.scopes,
      revokedAt: input.revokedAt ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  })
  return raw
}

describe("scopeAllows", () => {
  it("grants only the exact scope asked for", () => {
    expect(scopeAllows(["assets:read"], "assets:read")).toBe(true)
    expect(scopeAllows(["assets:read"], "assets:write")).toBe(false)
  })

  it("refuses when the key has no scopes at all", () => {
    expect(scopeAllows([], "assets:read")).toBe(false)
    expect(scopeAllows(null, "assets:read")).toBe(false)
    expect(scopeAllows(undefined, "assets:read")).toBe(false)
  })

  it("treats admin as a wildcard, deliberately", () => {
    expect(scopeAllows(["admin"], "assets:write")).toBe(true)
    expect(scopeAllows(["appdata:admin"], "appdata:read")).toBe(true)
  })

  it("does not grant on a prefix or substring of a scope", () => {
    expect(scopeAllows(["assets:readonly"], "assets:read")).toBe(false)
    expect(scopeAllows(["assets"], "assets:read")).toBe(false)
    expect(scopeAllows(["not-admin"], "assets:read")).toBe(false)
  })

  it("scopeAllowsAny needs only one of the listed scopes", () => {
    expect(scopeAllowsAny(["uploads:create"], ["assets:write", "uploads:create"])).toBe(true)
    expect(scopeAllowsAny(["activity:read"], ["assets:write", "uploads:create"])).toBe(false)
  })
})

describe("authenticateFlexible with an API key", () => {
  it("accepts a valid key and attaches its scopes", async () => {
    const raw = await createKey({ scopes: ["assets:read"] })
    const { request, reply, captured } = makeRequest(`Bearer ${raw}`)

    await authenticateFlexible(request, reply)

    expect(captured.status).toBeNull()
    expect((request as { auth?: { apiKeyScopes: string[] } }).auth?.apiKeyScopes).toEqual([
      "assets:read",
    ])
  })

  it("rejects a revoked key", async () => {
    const raw = await createKey({ scopes: ["assets:read"], revokedAt: new Date() })
    const { request, reply, captured } = makeRequest(`Bearer ${raw}`)

    await authenticateFlexible(request, reply)

    expect(captured.status).toBe(401)
    expect((request as { auth?: unknown }).auth).toBeUndefined()
  })

  it("rejects an expired key", async () => {
    const raw = await createKey({
      scopes: ["assets:read"],
      expiresAt: new Date(Date.now() - 60_000),
    })
    const { request, reply, captured } = makeRequest(`Bearer ${raw}`)

    await authenticateFlexible(request, reply)

    expect(captured.status).toBe(401)
  })

  it("rejects a key whose owner has been disabled", async () => {
    const raw = await createKey({ scopes: ["assets:read"] })
    await prisma.user.update({
      where: { id: fixtures.user.id },
      data: { status: "DISABLED" },
    })

    const { request, reply, captured } = makeRequest(`Bearer ${raw}`)
    await authenticateFlexible(request, reply)

    expect(captured.status).toBe(401)

    await prisma.user.update({
      where: { id: fixtures.user.id },
      data: { status: "ACTIVE" },
    })
  })

  it("rejects a made-up key", async () => {
    const { request, reply, captured } = makeRequest("Bearer arc_not-a-real-key-at-all")
    await authenticateFlexible(request, reply)
    expect(captured.status).toBe(401)
  })

  it("rejects a request with no credential", async () => {
    const { request, reply, captured } = makeRequest()
    await authenticateFlexible(request, reply)
    expect(captured.status).toBe(401)
  })
})

describe("requireSessionRolesOrApiKeyScopes", () => {
  it("lets a key through when it holds the required scope", async () => {
    const raw = await createKey({ scopes: ["assets:write"] })
    const guard = requireSessionRolesOrApiKeyScopes(["OWNER"], ["assets:write"])
    const { request, reply, captured } = makeRequest(`Bearer ${raw}`)

    await guard(request, reply)
    expect(captured.status).toBeNull()
  })

  /**
   * The case that matters: a real, live, correctly-owned key that simply is not
   * allowed to do this. It must be a 403, not a pass because the user behind
   * the key happens to be the OWNER.
   */
  it("refuses a valid key that lacks the scope, even for an OWNER's key", async () => {
    const raw = await createKey({ scopes: ["assets:read"] })
    const guard = requireSessionRolesOrApiKeyScopes(["OWNER"], ["assets:write"])
    const { request, reply, captured } = makeRequest(`Bearer ${raw}`)

    await guard(request, reply)

    expect(captured.status).toBe(403)
    expect(captured.body).toMatchObject({
      error: { code: "FORBIDDEN" },
    })
  })

  it("refuses a read-scoped key on every write-scoped guard", async () => {
    const raw = await createKey({ scopes: ["assets:read", "activity:read"] })

    for (const required of [
      ["assets:write"],
      ["uploads:create"],
      ["libraries:write"],
      ["admin"],
    ]) {
      const guard = requireSessionRolesOrApiKeyScopes(["OWNER"], required)
      const { request, reply, captured } = makeRequest(`Bearer ${raw}`)
      await guard(request, reply)
      expect(captured.status, `expected 403 for ${required.join(",")}`).toBe(403)
    }
  })

  it("lets an admin-scoped key through any scope guard", async () => {
    const raw = await createKey({ scopes: ["admin"] })
    const guard = requireSessionRolesOrApiKeyScopes(["OWNER"], ["libraries:write"])
    const { request, reply, captured } = makeRequest(`Bearer ${raw}`)

    await guard(request, reply)
    expect(captured.status).toBeNull()
  })
})

/**
 * FIX-017 — a role is not something you can hand out.
 *
 * `requireSessionRole` (then named `requireRole`) authenticated flexibly and
 * then checked only `auth.user.role`. Because an API key authenticates *as its
 * owner*, a key scoped `assets:read` satisfied every OWNER/ADMIN route: it
 * created model profiles, and it minted a fresh key with `["admin"]`. Scopes
 * were decoration on 113 call sites.
 *
 * The surfaces behind that guard — settings, models, webhooks, api-keys,
 * license, logs, the vault — have no entry in `API_KEY_SCOPES`, so refusing
 * keys there removes nothing a published key was ever promised.
 */
async function makeSessionRequest(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" = "OWNER") {
  const user =
    role === "OWNER"
      ? fixtures.user
      : await prisma.user.create({
          data: {
            email: `scope-${role.toLowerCase()}-${Date.now()}@arciin.invalid`,
            name: role,
            passwordHash: "x",
            role,
            status: "ACTIVE",
          },
        })

  // The row directly, rather than createSession(): this test is about what the
  // guard does with a resolved session, not about how one is minted.
  const token = `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 1)
  await prisma.session.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
  })

  const captured: Captured = { status: null, body: null }
  const request = {
    headers: {},
    cookies: { [process.env.SESSION_COOKIE_NAME || "arciin_session"]: token },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
    server: { prisma, redis },
    auth: undefined,
  } as never
  const reply = {
    status(code: number) { captured.status = code; return this },
    send(body: unknown) { captured.body = body; return this },
  } as never

  return { request, reply, captured }
}

describe("requireSessionRole refuses API keys outright", () => {
  const PRIVILEGED = ["OWNER", "ADMIN"] as const

  it("refuses a read-scoped key — the exact escalation that was found", async () => {
    const raw = await createKey({ scopes: ["assets:read"] })
    const { request, reply, captured } = makeRequest(`Bearer ${raw}`)

    await requireSessionRole([...PRIVILEGED])(request, reply)

    expect(captured.status).toBe(403)
    expect(captured.body).toMatchObject({ error: { code: "SESSION_REQUIRED" } })
  })

  it("refuses an admin-scoped key too — no scope buys a role", async () => {
    const raw = await createKey({ scopes: ["admin"] })
    const { request, reply, captured } = makeRequest(`Bearer ${raw}`)

    await requireSessionRole([...PRIVILEGED])(request, reply)

    expect(captured.status).toBe(403)
    expect(captured.body).toMatchObject({ error: { code: "SESSION_REQUIRED" } })
  })

  it("refuses a key holding every scope there is", async () => {
    const raw = await createKey({
      scopes: ["assets:read", "assets:write", "libraries:write", "uploads:create", "admin"],
    })
    const { request, reply, captured } = makeRequest(`Bearer ${raw}`)

    await requireSessionRole([...PRIVILEGED])(request, reply)
    expect(captured.status).toBe(403)
  })

  it("still lets a signed-in OWNER through", async () => {
    const { request, reply, captured } = await makeSessionRequest("OWNER")
    await requireSessionRole([...PRIVILEGED])(request, reply)
    expect(captured.status).toBeNull()
  })

  it("still refuses a signed-in VIEWER on a privileged route", async () => {
    const { request, reply, captured } = await makeSessionRequest("VIEWER")
    await requireSessionRole([...PRIVILEGED])(request, reply)
    expect(captured.status).toBe(403)
    expect(captured.body).toMatchObject({ error: { code: "FORBIDDEN" } })
  })

  it("distinguishes no credential (401) from a key (403)", async () => {
    const anon = makeRequest()
    await requireSessionRole([...PRIVILEGED])(anon.request, anon.reply)
    expect(anon.captured.status).toBe(401)

    const raw = await createKey({ scopes: ["assets:read"] })
    const keyed = makeRequest(`Bearer ${raw}`)
    await requireSessionRole([...PRIVILEGED])(keyed.request, keyed.reply)
    expect(keyed.captured.status).toBe(403)
  })

  it("the deprecated alias fails closed, so a missed import cannot reopen it", async () => {
    const { requireRole } = await import("../../apps/api/src/services/security/auth")
    const raw = await createKey({ scopes: ["admin"] })
    const { request, reply, captured } = makeRequest(`Bearer ${raw}`)

    await requireRole(["OWNER", "ADMIN"])(request, reply)
    expect(captured.status).toBe(403)
  })
})

describe("the escalation chain is broken end to end", () => {
  /**
   * The chain that mattered: any key, however weak, reaching the key-minting
   * route. One link is enough — if a key cannot pass the guard on
   * `POST /api-keys`, it cannot mint anything.
   */
  it("no key of any scope passes the guard that protects key creation", async () => {
    for (const scopes of [
      ["assets:read"],
      ["assets:write"],
      ["uploads:create"],
      ["activity:read"],
      ["admin"],
    ]) {
      const raw = await createKey({ scopes })
      const { request, reply, captured } = makeRequest(`Bearer ${raw}`)
      await requireSessionRole(["OWNER", "ADMIN"])(request, reply)
      expect(captured.status, `scopes=${scopes.join(",")} must not pass`).toBe(403)
    }
  })

  it("legitimate scoped access is untouched", async () => {
    const raw = await createKey({ scopes: ["assets:read"] })
    const { request, reply, captured } = makeRequest(`Bearer ${raw}`)

    await requireSessionRolesOrApiKeyScopes(["OWNER"], ["assets:read"])(request, reply)
    expect(captured.status).toBeNull()
  })
})
