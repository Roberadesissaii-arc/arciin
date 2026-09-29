import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { hashToken } from "../../apps/api/src/services/security/auth"
import { createTestStorageRoot, prisma, removeTestStorageRoot, resetDatabase } from "./setup"

/**
 * Clear inbox.
 *
 * The owner had thousands of notifications and no way to empty the inbox
 * short of reading them. "Clear" must empty *their inbox* and nothing else:
 * ActivityEvent is the audit trail and the Activity page, and other people's
 * inboxes read the same rows. So clearing is a per-user cursor, never a
 * delete — and these tests pin exactly that.
 */

let ownerId: string
let otherId: string
const published: Array<{ type: string; userId?: string; audience?: string; data?: unknown }> = []

async function sessionCookie(userId: string) {
  const raw = `sess_${userId}_${crypto.randomUUID()}`
  await prisma.session.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) } })
  return `arciin_session=${raw}`
}

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerNotificationRoutes } = await import("../../apps/api/src/modules/notifications/routes")
  const { registerActivityRoutes } = await import("../../apps/api/src/modules/activity/routes")
  const app = Fastify({ logger: false })
  app.decorate("prisma", prisma)
  app.decorate("publishRealtimeEvent", async (event: (typeof published)[number]) => {
    published.push(event)
  })
  await registerCookies(app)
  await app.register(
    async (api) => {
      await registerNotificationRoutes(api)
      await registerActivityRoutes(api)
    },
    { prefix: "/api" },
  )
  await app.ready()
  return app
}

let app: Awaited<ReturnType<typeof buildApp>>

async function inbox(cookie: string, query = "") {
  const res = await app.inject({ method: "GET", url: `/api/notifications${query}`, headers: { cookie } })
  expect(res.statusCode).toBe(200)
  return res.json().data as { items: Array<{ id: string; read: boolean }>; unreadCount: number; total: number }
}

async function clear(cookie: string) {
  const res = await app.inject({ method: "POST", url: "/api/notifications/clear", headers: { cookie } })
  expect(res.statusCode, res.body).toBe(200)
  return res.json().data as { cleared: boolean; clearedThrough: string | null }
}

async function event(input: { userId?: string | null; title: string; ago?: number }) {
  return prisma.activityEvent.create({
    data: {
      userId: input.userId ?? null,
      type: "upload.completed",
      title: input.title,
      createdAt: new Date(Date.now() - (input.ago ?? 0)),
    },
  })
}

beforeAll(async () => {
  await createTestStorageRoot()
  await resetDatabase()
  ownerId = (await prisma.user.create({ data: { email: "clear-owner@test.invalid", name: "Owner", passwordHash: "x", role: "OWNER", status: "ACTIVE" } })).id
  otherId = (await prisma.user.create({ data: { email: "clear-member@test.invalid", name: "Member", passwordHash: "x", role: "MEMBER", status: "ACTIVE" } })).id
  app = await buildApp()
})

afterAll(async () => {
  await app?.close()
  await prisma.notificationRead.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.notificationRead.deleteMany()
  await prisma.activityEvent.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.updateMany({ data: { notificationsReadThrough: null, notificationsClearedThrough: null } })
  published.length = 0
})

describe("clear inbox", () => {
  it("clearing an empty inbox is fine and changes nothing", async () => {
    const cookie = await sessionCookie(ownerId)
    expect(await clear(cookie)).toEqual({ cleared: true, clearedThrough: null })
    expect(await inbox(cookie)).toMatchObject({ items: [], unreadCount: 0, total: 0 })
  })

  it("empties a large inbox — and deletes no Activity", async () => {
    const cookie = await sessionCookie(ownerId)
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      userId: i % 3 === 0 ? null : ownerId,
      type: "upload.completed",
      title: `File ${i}`,
      createdAt: new Date(Date.now() - 60_000 - i * 10),
    }))
    await prisma.activityEvent.createMany({ data: rows })
    const before = await inbox(cookie)
    expect(before.total).toBe(1500)
    expect(before.unreadCount).toBe(1500)

    await clear(cookie)
    const after = await inbox(cookie)
    expect(after).toMatchObject({ items: [], unreadCount: 0, total: 0 })
    expect(await prisma.activityEvent.count()).toBe(1500)
  })

  it("the Activity page still shows what was cleared", async () => {
    const cookie = await sessionCookie(ownerId)
    const old = await event({ userId: ownerId, title: "Uploaded holiday.jpg", ago: 60_000 })
    await clear(cookie)
    const res = await app.inject({ method: "GET", url: "/api/activity", headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect((res.json().data as Array<{ id: string }>).map((a) => a.id)).toContain(old.id)
  })

  it("an event after the clear appears, unread", async () => {
    const cookie = await sessionCookie(ownerId)
    await event({ userId: ownerId, title: "Before", ago: 60_000 })
    await clear(cookie)
    const next = await event({ userId: ownerId, title: "After" })
    const view = await inbox(cookie)
    expect(view.items.map((i) => i.id)).toEqual([next.id])
    expect(view.unreadCount).toBe(1)
    expect(view.total).toBe(1)
  })

  it("the cursor is the newest cleared event, not the clock: a later event is never swallowed", async () => {
    const cookie = await sessionCookie(ownerId)
    const newest = await event({ userId: ownerId, title: "Newest before clear", ago: 5_000 })
    const result = await clear(cookie)
    expect(result.clearedThrough).toBe(newest.createdAt.toISOString())
    // Stamped between the newest event and the moment of clearing.
    const racing = await event({ userId: ownerId, title: "Racing", ago: 1_000 })
    expect((await inbox(cookie)).items.map((i) => i.id)).toContain(racing.id)
  })

  it("the cursor never moves backwards", async () => {
    const cookie = await sessionCookie(ownerId)
    await event({ userId: ownerId, title: "Newer", ago: 1_000 })
    const first = await clear(cookie)
    await prisma.activityEvent.deleteMany()
    await event({ userId: ownerId, title: "Older, written late", ago: 50_000 })
    const second = await clear(cookie)
    expect(second.clearedThrough).toBe(first.clearedThrough)
  })

  it("is private: another person's inbox is untouched", async () => {
    const owner = await sessionCookie(ownerId)
    const other = await sessionCookie(otherId)
    await event({ userId: null, title: "Instance-wide", ago: 30_000 })
    await event({ userId: otherId, title: "Theirs", ago: 20_000 })
    await event({ userId: ownerId, title: "Mine", ago: 10_000 })
    const theirsBefore = await inbox(other)
    await clear(owner)
    expect((await inbox(owner)).total).toBe(0)
    // Instance-wide events are cleared for the owner only.
    expect(await inbox(other)).toEqual(theirsBefore)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: otherId } })).notificationsClearedThrough).toBeNull()
  })

  it("every device of the same person sees the cleared inbox", async () => {
    const laptop = await sessionCookie(ownerId)
    const phone = await sessionCookie(ownerId)
    await event({ userId: ownerId, title: "One", ago: 5_000 })
    expect((await inbox(phone)).total).toBe(1)
    await clear(laptop)
    expect(await inbox(phone)).toMatchObject({ items: [], unreadCount: 0, total: 0 })
  })

  it("mark all read after clear does not bring anything back", async () => {
    const cookie = await sessionCookie(ownerId)
    await event({ userId: ownerId, title: "Cleared", ago: 5_000 })
    await clear(cookie)
    const res = await app.inject({ method: "POST", url: "/api/notifications/mark-all-read", headers: { cookie } })
    expect(res.statusCode).toBe(200)
    expect(await inbox(cookie)).toMatchObject({ items: [], unreadCount: 0, total: 0 })
  })

  it("read markers for cleared events are removed and stay gone; newer ones are kept", async () => {
    const cookie = await sessionCookie(ownerId)
    const old = await event({ userId: ownerId, title: "Old", ago: 60_000 })
    await app.inject({ method: "PATCH", url: `/api/notifications/${old.id}/read`, headers: { cookie } })
    expect(await prisma.notificationRead.count({ where: { userId: ownerId } })).toBe(1)
    await clear(cookie)
    expect(await prisma.notificationRead.count({ where: { userId: ownerId } })).toBe(0)
    // Marking a cleared event read again is harmless and does not resurrect it.
    await app.inject({ method: "PATCH", url: `/api/notifications/${old.id}/read`, headers: { cookie } })
    expect((await inbox(cookie)).items).toEqual([])
    // Another user's read markers are not touched.
    const other = await sessionCookie(otherId)
    const shared = await event({ userId: null, title: "Shared", ago: 1_000 })
    await app.inject({ method: "PATCH", url: `/api/notifications/${shared.id}/read`, headers: { cookie: other } })
    await clear(cookie)
    expect(await prisma.notificationRead.count({ where: { userId: otherId } })).toBe(1)
  })

  it("tells this person's other tabs, privately and without content", async () => {
    const cookie = await sessionCookie(ownerId)
    await event({ userId: ownerId, title: "Secret project.pdf uploaded", ago: 5_000 })
    await clear(cookie)
    const sent = published.filter((e) => e.type === "notifications.cleared")
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ userId: ownerId, audience: "user" })
    expect(JSON.stringify(sent[0])).not.toMatch(/Secret project/)
  })

  it("needs a session", async () => {
    const res = await app.inject({ method: "POST", url: "/api/notifications/clear" })
    expect(res.statusCode).toBe(401)
  })

  it("paging after a clear counts only what is left", async () => {
    const cookie = await sessionCookie(ownerId)
    await prisma.activityEvent.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({ userId: ownerId, type: "upload.completed", title: `Old ${i}`, createdAt: new Date(Date.now() - 100_000 - i) })),
    })
    await clear(cookie)
    await prisma.activityEvent.createMany({
      data: Array.from({ length: 12 }, (_, i) => ({ userId: ownerId, type: "upload.completed", title: `New ${i}`, createdAt: new Date(Date.now() + 1_000 + i) })),
    })
    const page2 = await inbox(cookie, "?limit=10&offset=10")
    expect(page2.total).toBe(12)
    expect(page2.items).toHaveLength(2)
    expect(page2.unreadCount).toBe(12)
  })
})
