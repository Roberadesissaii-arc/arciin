import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { hashToken } from "../../apps/api/src/services/security/auth"
import { createTestStorageRoot, prisma, removeTestStorageRoot, resetDatabase, seedBaseFixtures, type Fixtures } from "./setup"

/**
 * Database → API Keys status filter: All / Active / Revoked / Expired.
 *
 * The audit view keeps every key ever issued; the filter narrows the view in
 * the database, so totals and paging describe the filtered set. Revocation
 * wins over expiry, and a null expiry (keys from before v1.1.0) is Active.
 */

let fixtures: Fixtures
let cookie: string
let app: Awaited<ReturnType<typeof buildApp>>
const ids: Record<string, string> = {}

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerAdminRoutes } = await import("../../apps/api/src/modules/admin/routes")
  const a = Fastify({ logger: false })
  a.decorate("prisma", prisma)
  a.decorate("redis", { incr: async () => 1, expire: async () => 1, get: async () => null, del: async () => 1 })
  await registerCookies(a)
  await a.register(async (api) => registerAdminRoutes(api), { prefix: "/api" })
  await a.ready()
  return a
}

beforeAll(async () => {
  await resetDatabase()
  fixtures = await seedBaseFixtures(await createTestStorageRoot())
  await prisma.apiKey.deleteMany()
  const day = 86_400_000
  const make = async (label: string, data: { revokedAt?: Date | null; expiresAt?: Date | null }) => {
    const row = await prisma.apiKey.create({
      data: {
        userId: fixtures.user.id,
        name: label,
        keyPrefix: `arc_${label}`.slice(0, 12),
        keyHash: `hash-${label}-${Date.now()}`,
        scopes: ["assets:read"],
        revokedAt: data.revokedAt ?? null,
        expiresAt: data.expiresAt ?? null,
      },
    })
    ids[label] = row.id
  }
  await make("active", { expiresAt: new Date(Date.now() + 30 * day) })
  await make("grandfathered", { expiresAt: null })
  await make("revoked", { revokedAt: new Date() })
  await make("revokedAndExpired", { revokedAt: new Date(), expiresAt: new Date(Date.now() - day) })
  await make("expired", { expiresAt: new Date(Date.now() - day) })

  const raw = `sess_${crypto.randomUUID()}`
  await prisma.session.create({
    data: { userId: fixtures.user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + day) },
  })
  cookie = `arciin_session=${raw}`
  app = await buildApp()
})

afterAll(async () => {
  await app?.close()
  await prisma.apiKey.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

async function list(status?: string) {
  const res = await app.inject({
    method: "GET",
    url: `/api/admin/tables/api-keys?page=1&limit=50${status ? `&status=${status}` : ""}`,
    headers: { cookie },
  })
  return res
}

const names = (rows: Array<{ name: string }>) => rows.map((r) => r.name).sort()

describe("Database → API Keys filter", () => {
  it("All is the default and keeps every key, revoked history included", async () => {
    const res = await list()
    expect(res.statusCode).toBe(200)
    expect(res.json().data.total).toBe(5)
    expect((await list("all")).json().data.total).toBe(5)
  })

  it("Active: unrevoked, and unexpired or never-expiring", async () => {
    const data = (await list("active")).json().data
    expect(names(data.rows)).toEqual(["active", "grandfathered"])
    expect(data.total).toBe(2)
    expect(data.rows.every((r: { status: string }) => r.status === "Active")).toBe(true)
  })

  it("Revoked: revocation wins over expiry", async () => {
    const data = (await list("revoked")).json().data
    expect(names(data.rows)).toEqual(["revoked", "revokedAndExpired"])
    expect(data.rows.every((r: { status: string }) => r.status === "Revoked")).toBe(true)
  })

  it("Expired: past expiry and not revoked", async () => {
    const data = (await list("expired")).json().data
    expect(names(data.rows)).toEqual(["expired"])
    expect(data.rows[0].status).toBe("Expired")
  })

  it("the filters partition All exactly", async () => {
    const [a, r, e] = await Promise.all(["active", "revoked", "expired"].map(async (s) => (await list(s)).json().data.total))
    expect(a + r + e).toBe(5)
  })

  it("never exposes the key hash", async () => {
    expect((await list()).body).not.toContain("keyHash")
    expect((await list()).body).not.toContain("hash-")
  })

  it("an unknown status is a 400, not a silently unfiltered list", async () => {
    const res = await list("deleted")
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("VALIDATION_ERROR")
  })

  it("filtering is read-only: no row was removed", async () => {
    await list("active")
    await list("revoked")
    expect(await prisma.apiKey.count()).toBe(5)
  })
})
