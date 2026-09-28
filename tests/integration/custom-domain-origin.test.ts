import type { AddressInfo } from "node:net"

import { authenticator } from "otplib"
import Redis from "ioredis"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

/**
 * A custom public domain saved in Settings → Domain is where the owner signs
 * in from — end to end, through the real CORS plugin, auth routes, MFA and
 * Socket.IO.
 *
 * Production: https://app.arciin.com served /login and every POST /auth/login
 * answered 403 ORIGIN_NOT_ALLOWED; only the live quick-tunnel URL was trusted.
 */

// Before the API modules load: cors-origins reads it once at import.
process.env.ARCIIN_EXTRA_CORS_ORIGINS = "https://extra.example.com"

import { hashPassword, hashToken } from "../../apps/api/src/services/security/auth"
import { encryptSecret } from "../../apps/api/src/services/security/encryption"
import {
  createTestStorageRoot,
  grantTestLicense,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

const CUSTOM = "https://app.arciin.com"
const PASSWORD = "correct horse battery staple 42"
let fixtures: Fixtures
let redis: Redis
let app: Awaited<ReturnType<typeof buildApp>>
let ownerCookie: string
let totpSecret: string

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerJsonBodyParser } = await import("../../apps/api/src/plugins/json-body")
  const { registerErrorHandler } = await import("../../apps/api/src/plugins/error-handler")
  const { registerCors } = await import("../../apps/api/src/plugins/cors")
  const { registerSocket } = await import("../../apps/api/src/plugins/socket")
  const { registerAuthRoutes } = await import("../../apps/api/src/modules/auth/routes")
  const { registerSettingsRoutes } = await import("../../apps/api/src/modules/settings/routes")
  const a = Fastify({ logger: false })
  a.decorate("prisma", prisma)
  a.decorate("redis", redis)
  registerJsonBodyParser(a)
  await registerErrorHandler(a)
  await registerCors(a)
  await registerCookies(a)
  await registerSocket(a)
  await a.register(
    async (api) => {
      await registerAuthRoutes(api)
      await registerSettingsRoutes(api)
    },
    { prefix: "/api" },
  )
  await a.ready()
  return a
}

async function loadTrust() {
  const { refreshTrustedCustomPublicOrigin } = await import("../../apps/api/src/services/remote-access/custom-public-origin")
  return refreshTrustedCustomPublicOrigin(prisma)
}

async function setPublicUrl(publicUrl: string | null) {
  await prisma.instanceConfig.updateMany({ data: { publicUrl } })
}

async function setOwnerMfa(enabled: boolean) {
  await prisma.user.update({
    where: { id: fixtures.user.id },
    data: enabled
      ? { mfaEnabledAt: new Date(), mfaSecretEnc: encryptSecret(totpSecret), mfaLastUsedStep: null }
      : { mfaEnabledAt: null, mfaSecretEnc: null, mfaLastUsedStep: null },
  })
}

async function preflight(origin: string) {
  return app.inject({
    method: "OPTIONS",
    url: "/api/auth/login",
    headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type" },
  })
}

async function login(origin: string, email: string, password: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { origin, "content-type": "application/json" },
    payload: { email, password, ...extra },
  })
}

function sessionCookie(res: { headers: Record<string, unknown> }) {
  const raw = res.headers["set-cookie"]
  const all = (Array.isArray(raw) ? raw : raw ? [String(raw)] : []) as string[]
  return all.find((c) => c.startsWith("arciin_session="))
}

beforeAll(async () => {
  const root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
  await grantTestLicense(root, "pro")
  totpSecret = authenticator.generateSecret()
  await prisma.user.update({ where: { id: fixtures.user.id }, data: { passwordHash: await hashPassword(PASSWORD) } })
  const raw = `sess_${crypto.randomUUID()}`
  await prisma.session.create({
    data: { userId: fixtures.user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) },
  })
  ownerCookie = `arciin_session=${raw}`
  redis = new Redis(process.env.REDIS_URL!)
  app = await buildApp()
})

afterAll(async () => {
  const { setTrustedCustomPublicOrigin } = await import("../../apps/api/src/plugins/cors-origins")
  setTrustedCustomPublicOrigin(null)
  await app?.close()
  const keys = await redis.keys("*")
  if (keys.length) await redis.del(...keys)
  await redis.quit()
  await prisma.instanceConfig.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

beforeEach(async () => {
  const keys = await redis.keys("*")
  if (keys.length) await redis.del(...keys)
  await setOwnerMfa(true)
  await setPublicUrl(CUSTOM)
  await loadTrust()
})

describe("the custom domain is trusted — exactly, and only while configured", () => {
  it("A: startup loads InstanceConfig.publicUrl and the preflight answers for it", async () => {
    const res = await preflight(CUSTOM)
    expect(res.statusCode).toBe(204)
    expect(res.headers["access-control-allow-origin"]).toBe(CUSTOM)
    expect(res.headers["access-control-allow-credentials"]).toBe("true")
  })

  it("B/C: an unrelated domain, a sibling subdomain and the http variant are refused", async () => {
    for (const origin of ["https://evil.example.com", "https://other.arciin.com", "http://app.arciin.com"]) {
      const res = await login(origin, fixtures.user.email, PASSWORD)
      expect(res.statusCode, origin).toBe(403)
      expect(res.json().error.code, origin).toBe("ORIGIN_NOT_ALLOWED")
    }
  })

  it("D/E: a Settings change trusts the new domain at once and drops the old one — no restart", async () => {
    const save = await app.inject({
      method: "PATCH",
      url: "/api/settings/remote-access",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { publicUrl: "https://files.example.com/some/path" },
    })
    expect(save.statusCode, save.body).toBe(200)
    expect((await preflight("https://files.example.com")).statusCode).toBe(204)
    expect((await login(CUSTOM, fixtures.user.email, PASSWORD)).statusCode).toBe(403)

    const clear = await app.inject({
      method: "PATCH",
      url: "/api/settings/remote-access",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { publicUrl: "" },
    })
    expect(clear.statusCode).toBe(200)
    expect((await login("https://files.example.com", fixtures.user.email, PASSWORD)).statusCode).toBe(403)
  })

  it("a failed save changes nothing: bad input is refused and the current domain stays trusted", async () => {
    const bad = await app.inject({
      method: "PATCH",
      url: "/api/settings/remote-access",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { publicUrl: "https://user:pw@files.example.com" },
    })
    expect(bad.statusCode).toBe(400)
    expect((await prisma.instanceConfig.findFirstOrThrow()).publicUrl).toBe(CUSTOM)
    expect((await preflight(CUSTOM)).statusCode).toBe(204)
  })

  it("G: a stored trycloudflare address is not trusted without its live tunnel", async () => {
    await setPublicUrl("https://abc-def.trycloudflare.com")
    const state = await loadTrust()
    expect(state).toEqual({ trusted: false, reason: "quick-tunnel" })
    expect((await login("https://abc-def.trycloudflare.com", fixtures.user.email, PASSWORD)).statusCode).toBe(403)
  })

  it("H: ARCIIN_EXTRA_CORS_ORIGINS still works alongside", async () => {
    expect((await preflight("https://extra.example.com")).statusCode).toBe(204)
  })

  it("K: a malformed stored value trusts nothing and does not throw", async () => {
    await setPublicUrl("not a url at all")
    await expect(loadTrust()).resolves.toEqual({ trusted: false, reason: "malformed" })
    expect((await login(CUSTOM, fixtures.user.email, PASSWORD)).statusCode).toBe(403)
  })

  it("L: a stored URL with path, query, case and default port trusts just its origin", async () => {
    await setPublicUrl("https://APP.arciin.com:443/login?next=%2Ffiles")
    await loadTrust()
    expect((await preflight(CUSTOM)).statusCode).toBe(204)
  })
})

describe("public custom domains follow the owner-MFA rule", () => {
  it("without the owner's second factor a public domain is not trusted, and cannot be saved", async () => {
    await setOwnerMfa(false)
    expect(await loadTrust()).toEqual({ trusted: false, reason: "owner-mfa-required" })
    expect((await login(CUSTOM, fixtures.user.email, PASSWORD)).statusCode).toBe(403)

    const save = await app.inject({
      method: "PATCH",
      url: "/api/settings/remote-access",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { publicUrl: "https://files.example.com" },
    })
    expect(save.statusCode).toBe(403)
    expect(save.json().error.code).toBe("OWNER_MFA_REQUIRED")
    expect((await prisma.instanceConfig.findFirstOrThrow()).publicUrl).toBe(CUSTOM)
  })

  it("a LAN hostname needs no second factor", async () => {
    await setOwnerMfa(false)
    const save = await app.inject({
      method: "PATCH",
      url: "/api/settings/remote-access",
      headers: { cookie: ownerCookie, "content-type": "application/json" },
      payload: { publicUrl: "http://192.168.50.10:3002" },
    })
    expect(save.statusCode, save.body).toBe(200)
    expect((await preflight("http://192.168.50.10:3002")).statusCode).toBe(204)
  })

  it("no paid plan is required: a Free owner with MFA can use their own domain", async () => {
    await prisma.instanceConfig.updateMany({ data: { licensePlan: "free", licenseStatus: "none", licenseSignedToken: null } })
    await loadTrust()
    expect((await preflight(CUSTOM)).statusCode).toBe(204)
    await grantTestLicense((await prisma.instanceConfig.findFirstOrThrow()).storageRoot, "pro")
    await setPublicUrl(CUSTOM)
  })
})

describe("signing in through the custom domain", () => {
  it("M/N: a member without MFA signs in, gets a host-only session cookie, and /auth/me works", async () => {
    const member = await prisma.user.create({
      data: { email: "member@custom-domain.test", name: "Member", passwordHash: await hashPassword(PASSWORD), role: "MEMBER", status: "ACTIVE" },
    })
    const res = await login(CUSTOM, member.email, PASSWORD, { rememberMe: true })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.headers["access-control-allow-origin"]).toBe(CUSTOM)
    const cookie = sessionCookie(res)
    expect(cookie).toBeTruthy()
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Lax/i)
    expect(cookie).not.toMatch(/Domain=/i)
    expect(cookie).toMatch(/Expires=/i) // Remember Me → persistent

    const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: { origin: CUSTOM, cookie: cookie!.split(";")[0]! } })
    expect(me.statusCode).toBe(200)
    expect(me.json().data.user.email).toBe(member.email)

    const out = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { origin: CUSTOM, cookie: cookie!.split(";")[0]! } })
    expect(out.statusCode).toBeLessThan(300)
    const after = await app.inject({ method: "GET", url: "/api/auth/me", headers: { origin: CUSTOM, cookie: cookie!.split(";")[0]! } })
    expect(after.statusCode).toBe(401)
  })

  it("O: the owner's password alone gives an MFA challenge; the code completes sign-in", async () => {
    const first = await login(CUSTOM, fixtures.user.email, PASSWORD)
    expect(first.statusCode, first.body).toBe(200)
    expect(sessionCookie(first)).toBeUndefined()
    const challengeToken = first.json().data.challengeToken as string
    expect(challengeToken).toBeTruthy()

    const second = await app.inject({
      method: "POST",
      url: "/api/auth/mfa/challenge",
      headers: { origin: CUSTOM, "content-type": "application/json" },
      payload: { challengeToken, totp: authenticator.generate(totpSecret) },
    })
    expect(second.statusCode, second.body).toBe(200)
    expect(second.headers["access-control-allow-origin"]).toBe(CUSTOM)
    expect(sessionCookie(second)).toBeTruthy()
  })
})

describe("P: realtime uses the same trust", () => {
  it("the Socket.IO handshake accepts the custom domain and refuses others", async () => {
    await app.listen({ port: 0, host: "127.0.0.1" })
    const { port } = app.server.address() as AddressInfo
    const handshake = (origin: string) =>
      fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, { headers: { origin } })
    const ok = await handshake(CUSTOM)
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain('"sid"')
    // (localhost is allowed outside production by the shared policy — this suite runs as NODE_ENV=test.)
    for (const origin of ["https://evil.example.com", "https://other.arciin.com", "https://app.arciin.com.evil.com"]) {
      expect((await handshake(origin)).status, origin).toBe(400)
    }
    expect((await handshake("https://extra.example.com")).status).toBe(200)
  })
})

describe("a quick tunnel starting does not displace the custom domain", () => {
  it("keeps publicUrl and its trust, and clears a stale quick-tunnel mobile address", async () => {
    await prisma.instanceConfig.updateMany({
      data: { remoteAccessConfig: { mobilePublicUrl: "https://old-name.trycloudflare.com", cloudflareTunnelEnabled: true } },
    })
    const { persistTunnelPublicUrl } = await import("../../apps/api/src/services/remote-access/tunnel-persistence")
    await persistTunnelPublicUrl(app as never, "https://new-name.trycloudflare.com")
    const row = await prisma.instanceConfig.findFirstOrThrow()
    expect(row.publicUrl).toBe(CUSTOM)
    expect((row.remoteAccessConfig as Record<string, unknown>).mobilePublicUrl).toBeNull()
    expect((await preflight(CUSTOM)).statusCode).toBe(204)
  })
})
