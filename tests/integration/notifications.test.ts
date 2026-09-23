import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { hashToken } from "../../apps/api/src/services/security/auth"
import { createTestStorageRoot, prisma, removeTestStorageRoot, resetDatabase } from "./setup"

/**
 * Server-backed notifications.
 *
 * The inbox used to be a localStorage file, which meant a second device, a
 * second tab after "mark all read", or a cleared browser each had their own
 * idea of what was unread. These tests pin the server contract the web client
 * now treats as the only authority: read state survives a new session, is
 * shared between sessions of the same person, and is private to that person.
 */

let ownerId: string
let otherId: string

async function sessionCookie(userId: string) {
  const raw = `sess_${userId}_${crypto.randomUUID()}`
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) },
  })
  return `arciin_session=${raw}`
}

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerNotificationRoutes } = await import(
    "../../apps/api/src/modules/notifications/routes"
  )
  const app = Fastify({ logger: false })
  app.decorate("prisma", prisma)
  await registerCookies(app)
  await app.register(async (api) => registerNotificationRoutes(api), { prefix: "/api" })
  await app.ready()
  return app
}

async function inbox(app: Awaited<ReturnType<typeof buildApp>>, cookie: string) {
  const res = await app.inject({ method: "GET", url: "/api/notifications", headers: { cookie } })
  expect(res.statusCode).toBe(200)
  return res.json().data as {
    items: Array<{ id: string; read: boolean; metadata: Record<string, unknown> | null }>
    unreadCount: number
  }
}

beforeAll(async () => {
  await createTestStorageRoot()
  await resetDatabase()
  ownerId = (
    await prisma.user.create({
      data: { email: "notify-owner@test.invalid", name: "Owner", passwordHash: "x", role: "OWNER", status: "ACTIVE" },
    })
  ).id
  otherId = (
    await prisma.user.create({
      data: { email: "notify-member@test.invalid", name: "Member", passwordHash: "x", role: "MEMBER", status: "ACTIVE" },
    })
  ).id
})

afterAll(async () => {
  await prisma.notificationRead.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.notificationRead.deleteMany()
  await prisma.activityEvent.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.updateMany({ data: { notificationsReadThrough: null } })
})

async function seedEvents() {
  const base = Date.now() - 60_000
  const mine = await prisma.activityEvent.create({
    data: { userId: ownerId, type: "upload.completed", title: "Uploaded a.txt", createdAt: new Date(base) },
  })
  const instance = await prisma.activityEvent.create({
    data: { userId: null, type: "storage.warning", title: "Disk almost full", createdAt: new Date(base + 1000) },
  })
  const theirs = await prisma.activityEvent.create({
    data: { userId: otherId, type: "auth.login", title: "Member signed in", createdAt: new Date(base + 2000) },
  })
  return { mine, instance, theirs }
}

describe("notifications", () => {
  it("rejects unauthenticated requests with a JSON 401", async () => {
    const app = await buildApp()
    try {
      for (const [method, url] of [
        ["GET", "/api/notifications"],
        ["PATCH", "/api/notifications/x/read"],
        ["POST", "/api/notifications/mark-all-read"],
      ] as const) {
        const res = await app.inject({ method, url })
        expect(res.statusCode).toBe(401)
        expect(res.json().error.code).toBe("UNAUTHENTICATED")
      }
    } finally {
      await app.close()
    }
  })

  it("lists own and instance-wide events, never another user's", async () => {
    const { mine, instance, theirs } = await seedEvents()
    const app = await buildApp()
    try {
      const data = await inbox(app, await sessionCookie(ownerId))
      const ids = data.items.map((i) => i.id)
      expect(ids).toContain(mine.id)
      expect(ids).toContain(instance.id)
      expect(ids).not.toContain(theirs.id)
      expect(data.unreadCount).toBe(2)
    } finally {
      await app.close()
    }
  })

  it("marks one read, and the state survives a brand-new session", async () => {
    const { mine } = await seedEvents()
    const app = await buildApp()
    try {
      const first = await sessionCookie(ownerId)
      const res = await app.inject({
        method: "PATCH",
        url: `/api/notifications/${mine.id}/read`,
        headers: { cookie: first },
      })
      expect(res.statusCode).toBe(200)

      // Idempotent: a second tab racing the first must not error.
      const again = await app.inject({
        method: "PATCH",
        url: `/api/notifications/${mine.id}/read`,
        headers: { cookie: first },
      })
      expect(again.statusCode).toBe(200)

      const fresh = await inbox(app, await sessionCookie(ownerId))
      expect(fresh.unreadCount).toBe(1)
      expect(fresh.items.find((i) => i.id === mine.id)?.read).toBe(true)
    } finally {
      await app.close()
    }
  })

  it("mark-all in one session clears the other session, and new events are unread again", async () => {
    await seedEvents()
    const app = await buildApp()
    try {
      const laptop = await sessionCookie(ownerId)
      const phone = await sessionCookie(ownerId)
      expect((await inbox(app, phone)).unreadCount).toBe(2)

      const res = await app.inject({
        method: "POST",
        url: "/api/notifications/mark-all-read",
        headers: { cookie: laptop },
      })
      expect(res.statusCode).toBe(200)

      const phoneView = await inbox(app, phone)
      expect(phoneView.unreadCount).toBe(0)
      expect(phoneView.items.every((i) => i.read)).toBe(true)

      await new Promise((r) => setTimeout(r, 5))
      await prisma.activityEvent.create({
        data: { userId: ownerId, type: "upload.completed", title: "Later upload" },
      })
      expect((await inbox(app, laptop)).unreadCount).toBe(1)
    } finally {
      await app.close()
    }
  })

  it("read state is per person: one user's mark-all does not touch another's", async () => {
    const { instance } = await seedEvents()
    const app = await buildApp()
    try {
      await app.inject({
        method: "POST",
        url: "/api/notifications/mark-all-read",
        headers: { cookie: await sessionCookie(ownerId) },
      })
      const member = await inbox(app, await sessionCookie(otherId))
      expect(member.items.find((i) => i.id === instance.id)?.read).toBe(false)
      expect(member.unreadCount).toBe(2)
    } finally {
      await app.close()
    }
  })

  it("cannot mark or probe another user's event (404, not 403)", async () => {
    const { theirs } = await seedEvents()
    const app = await buildApp()
    try {
      const cookie = await sessionCookie(ownerId)
      for (const id of [theirs.id, "forged-id-does-not-exist"]) {
        const res = await app.inject({
          method: "PATCH",
          url: `/api/notifications/${id}/read`,
          headers: { cookie },
        })
        expect(res.statusCode).toBe(404)
        expect(res.json().error.code).toBe("NOT_FOUND")
      }
      expect(await prisma.notificationRead.count()).toBe(0)
    } finally {
      await app.close()
    }
  })

  it("never returns credential-looking metadata", async () => {
    await prisma.activityEvent.create({
      data: {
        userId: ownerId,
        type: "api_key.created",
        title: "API key created",
        metadata: {
          keyPrefix: "arc_abc",
          rawKey: "arc_should_never_leave",
          apiKey: "arc_nope",
          tokenHash: "deadbeef",
          sessionToken: "nope",
          clientSecret: "nope",
          nested: { password: "hidden-in-an-object" },
          scopes: "assets:read",
        },
      },
    })
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/notifications",
        headers: { cookie: await sessionCookie(ownerId) },
      })
      const body = res.body
      for (const leaked of ["arc_should_never_leave", "arc_nope", "deadbeef", "hidden-in-an-object", "clientSecret"]) {
        expect(body).not.toContain(leaked)
      }
      expect(res.json().data.items[0].metadata).toEqual({ keyPrefix: "arc_abc", scopes: "assets:read" })
    } finally {
      await app.close()
    }
  })
})
