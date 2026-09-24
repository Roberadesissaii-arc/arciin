import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { hashToken } from "../../apps/api/src/services/security/auth"
import { prisma, resetDatabase } from "./setup"

/**
 * The saved sidebar choice survives a reload (same session) and a sign-in
 * (new session), because it lives on the account rather than in a browser.
 */

let userId: string

async function cookie() {
  const raw = `sess_${crypto.randomUUID()}`
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) },
  })
  return `arciin_session=${raw}`
}

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerAuthRoutes } = await import("../../apps/api/src/modules/auth/routes")
  const app = Fastify({ logger: false })
  app.decorate("prisma", prisma)
  app.decorate("redis", { incr: async () => 1, expire: async () => 1, get: async () => null, del: async () => 1 })
  await registerCookies(app)
  await app.register(async (api) => registerAuthRoutes(api), { prefix: "/api" })
  await app.ready()
  return app
}

beforeAll(async () => {
  await resetDatabase()
  userId = (
    await prisma.user.create({
      data: {
        email: "sidebar@test.invalid",
        name: "Sidebar",
        passwordHash: "x",
        role: "OWNER",
        status: "ACTIVE",
        preferences: { appearance: { accentColor: "#3b82f6" } },
      },
    })
  ).id
})

afterAll(async () => {
  await resetDatabase()
  await prisma.$disconnect()
})

describe("sidebar preference", () => {
  it("collapse → reload → collapsed; expand → new sign-in → expanded", async () => {
    const app = await buildApp()
    try {
      const tab = await cookie()
      const get = async (c: string) =>
        (await app.inject({ method: "GET", url: "/api/auth/preferences", headers: { cookie: c } })).json().data

      expect((await get(tab)).appearance.sidebarCollapsed).toBe(false)

      const collapse = await app.inject({
        method: "PATCH",
        url: "/api/auth/preferences",
        headers: { cookie: tab },
        payload: { appearance: { sidebarCollapsed: true } },
      })
      expect(collapse.statusCode).toBe(200)
      expect((await get(tab)).appearance.sidebarCollapsed).toBe(true)
      // Unrelated settings are untouched.
      expect((await get(tab)).appearance.accentColor).toBe("#3b82f6")

      await app.inject({
        method: "PATCH",
        url: "/api/auth/preferences",
        headers: { cookie: tab },
        payload: { appearance: { sidebarCollapsed: false } },
      })
      expect((await get(await cookie())).appearance.sidebarCollapsed).toBe(false)

      const junk = await app.inject({
        method: "PATCH",
        url: "/api/auth/preferences",
        headers: { cookie: tab },
        payload: { appearance: { sidebarCollapsed: "yes" } },
      })
      expect(junk.statusCode).toBe(400)
    } finally {
      await app.close()
    }
  })
})
