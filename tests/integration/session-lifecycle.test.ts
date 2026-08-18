import Redis from "ioredis"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  DEVICE_COOKIE_NAME,
  createSession,
  hashToken,
  resolveSession,
} from "../../apps/api/src/services/security/auth"
import {
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

/**
 * Session lifecycle, and specifically which sessions a new sign-in is allowed
 * to destroy.
 *
 * Repeat sign-ins are collapsed so Settings → Sessions does not list the same
 * phone six times. That collapse used to key on (userId, userAgent, ipAddress),
 * which is a network position rather than a device: two browser profiles, a
 * private window, or two people behind one NAT all share it. Signing in on one
 * deleted the other's session, and the visible symptom was a random logout —
 * including, in CI, a 401 halfway through a Playwright file that had
 * authenticated correctly.
 *
 * The collapse now keys on an opaque per-browser cookie. The tests below are
 * mostly about what must *survive*.
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
  await prisma.session.deleteMany()
})

type SetCookie = { name: string; value: string }

/**
 * A request/reply pair for one browser.
 *
 * `deviceCookie` is what that browser already holds; cookies the reply sets are
 * captured so a follow-up sign-in can present them back, which is exactly what
 * a real browser does.
 */
function makeClient(opts: {
  userAgent?: string
  ip?: string
  deviceCookie?: string | null
}) {
  const setCookies: SetCookie[] = []

  const request = {
    headers: {
      "user-agent": opts.userAgent ?? "Mozilla/5.0 (Macintosh) Chrome/120",
    },
    cookies: opts.deviceCookie ? { [DEVICE_COOKIE_NAME]: opts.deviceCookie } : {},
    ip: opts.ip ?? "192.168.4.20",
    socket: { remoteAddress: opts.ip ?? "192.168.4.20" },
    server: { prisma, redis },
  } as never

  const reply = {
    setCookie(name: string, value: string) {
      setCookies.push({ name, value })
      return this
    },
  } as never

  return {
    request,
    reply,
    /** The device id this browser would now be holding. */
    deviceCookie(): string | null {
      const set = setCookies.find((c) => c.name === DEVICE_COOKIE_NAME)
      return set?.value ?? opts.deviceCookie ?? null
    },
  }
}

async function liveSessionCount(): Promise<number> {
  return prisma.session.count({ where: { userId: fixtures.user.id } })
}

describe("device identity", () => {
  it("mints a device cookie on a browser's first sign-in", async () => {
    const client = makeClient({ deviceCookie: null })
    await createSession(client.request, fixtures.user.id, { reply: client.reply })

    const device = client.deviceCookie()
    expect(device).toMatch(/^[a-f0-9]{32}$/)

    const row = await prisma.session.findFirstOrThrow({ where: { userId: fixtures.user.id } })
    expect(row.deviceId).toBe(device)
  })

  it("reuses the device id a browser already holds", async () => {
    const first = makeClient({ deviceCookie: null })
    await createSession(first.request, fixtures.user.id, { reply: first.reply })
    const device = first.deviceCookie()!

    const second = makeClient({ deviceCookie: device })
    await createSession(second.request, fixtures.user.id, { reply: second.reply })

    const rows = await prisma.session.findMany({ where: { userId: fixtures.user.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.deviceId).toBe(device)
  })

  it("ignores a malformed device cookie rather than trusting it", async () => {
    const client = makeClient({ deviceCookie: "../../etc/passwd" })
    await createSession(client.request, fixtures.user.id, { reply: client.reply })

    const row = await prisma.session.findFirstOrThrow({ where: { userId: fixtures.user.id } })
    expect(row.deviceId).toMatch(/^[a-f0-9]{32}$/)
    expect(row.deviceId).not.toBe("../../etc/passwd")
  })
})

describe("collapse", () => {
  it("replaces this browser's own previous session", async () => {
    const first = makeClient({ deviceCookie: null })
    const a = await createSession(first.request, fixtures.user.id, { reply: first.reply })
    const device = first.deviceCookie()!

    const again = makeClient({ deviceCookie: device })
    const b = await createSession(again.request, fixtures.user.id, { reply: again.reply })

    expect(await liveSessionCount()).toBe(1)

    // The old token stops working; the new one works.
    const oldLookup = await prisma.session.findUnique({
      where: { tokenHash: hashToken(a.rawToken) },
    })
    expect(oldLookup).toBeNull()
    expect(
      await prisma.session.findUnique({ where: { tokenHash: hashToken(b.rawToken) } }),
    ).not.toBeNull()
  })

  /**
   * The regression. Same user, same user-agent, same IP — two legitimate
   * browsers. Both sessions must survive.
   */
  it("keeps both sessions for two browser profiles on one machine", async () => {
    const profileA = makeClient({
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/120",
      ip: "192.168.4.20",
      deviceCookie: null,
    })
    const sessionA = await createSession(profileA.request, fixtures.user.id, {
      reply: profileA.reply,
    })

    const profileB = makeClient({
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/120",
      ip: "192.168.4.20",
      deviceCookie: null,
    })
    const sessionB = await createSession(profileB.request, fixtures.user.id, {
      reply: profileB.reply,
    })

    expect(profileA.deviceCookie()).not.toBe(profileB.deviceCookie())
    expect(await liveSessionCount()).toBe(2)

    for (const created of [sessionA, sessionB]) {
      const row = await prisma.session.findUnique({
        where: { tokenHash: hashToken(created.rawToken) },
      })
      expect(row, "both sessions must still resolve").not.toBeNull()
    }
  })

  it("keeps sessions for two people behind one NAT", async () => {
    const other = await prisma.user.create({
      data: {
        email: `itest-second-${Date.now()}@example.invalid`,
        name: "Second User",
        passwordHash: "not-a-real-hash",
        role: "MEMBER",
        status: "ACTIVE",
      },
    })

    const one = makeClient({ ip: "203.0.113.9", deviceCookie: null })
    await createSession(one.request, fixtures.user.id, { reply: one.reply })

    const two = makeClient({ ip: "203.0.113.9", deviceCookie: null })
    await createSession(two.request, other.id, { reply: two.reply })

    expect(await prisma.session.count()).toBe(2)

    await prisma.session.deleteMany({ where: { userId: other.id } })
    await prisma.user.delete({ where: { id: other.id } })
  })

  it("never collapses a client that sends no cookies at all (mobile Bearer)", async () => {
    // No reply → no cookie can be set → no device id → nothing to collapse on.
    const first = makeClient({ deviceCookie: null })
    await createSession(first.request, fixtures.user.id)

    const second = makeClient({ deviceCookie: null })
    await createSession(second.request, fixtures.user.id)

    expect(await liveSessionCount()).toBe(2)
    const rows = await prisma.session.findMany({ where: { userId: fixtures.user.id } })
    expect(rows.every((r) => r.deviceId === null)).toBe(true)
  })

  it("does not collapse across different users sharing a device id", async () => {
    const other = await prisma.user.create({
      data: {
        email: `itest-shared-device-${Date.now()}@example.invalid`,
        name: "Shared Device User",
        passwordHash: "not-a-real-hash",
        role: "MEMBER",
        status: "ACTIVE",
      },
    })

    const client = makeClient({ deviceCookie: null })
    await createSession(client.request, fixtures.user.id, { reply: client.reply })
    const device = client.deviceCookie()!

    // Same browser, second account — a shared family computer.
    const secondAccount = makeClient({ deviceCookie: device })
    await createSession(secondAccount.request, other.id, { reply: secondAccount.reply })

    expect(await prisma.session.count()).toBe(2)

    await prisma.session.deleteMany({ where: { userId: other.id } })
    await prisma.user.delete({ where: { id: other.id } })
  })
})

describe("resolveSession", () => {
  it("refuses an expired session server-side", async () => {
    const client = makeClient({ deviceCookie: null })
    const { session, rawToken } = await createSession(client.request, fixtures.user.id, {
      reply: client.reply,
    })

    await prisma.session.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

    const lookup = {
      cookies: { arciin_session: rawToken },
      headers: {},
      server: { prisma },
    } as never

    expect(await resolveSession(lookup)).toBeNull()
  })
})
