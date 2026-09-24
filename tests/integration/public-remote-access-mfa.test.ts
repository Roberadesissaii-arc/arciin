import { EventEmitter } from "node:events"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Public Remote Access requires the owner's second factor — on every path.
 *
 * `/start-mobile` once skipped the owner-MFA check that `/start` had, and
 * enabling the tunnel in Remote Access settings started one with no check at
 * all. Every path now goes through services/remote-access/public-tunnel.ts.
 *
 * `node:child_process` is mocked: nothing here can start a real cloudflared or
 * put anything on the internet. Each spawn is recorded instead, so "no tunnel
 * started" is an assertion about calls, not about timing.
 */

const spawned: Array<{ cmd: string; args: string[] }> = []

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return {
    ...actual,
    spawn: (cmd: string, args: string[]) => {
      spawned.push({ cmd, args })
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        kill: () => boolean
        pid: number
      }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => true
      child.pid = 424242
      // Behave like cloudflared publishing a quick-tunnel hostname.
      setTimeout(() => child.stderr.emit("data", Buffer.from("INF |  https://fake-policy-test.trycloudflare.com  |")), 5)
      return child
    },
  }
})

import { hashToken } from "../../apps/api/src/services/security/auth"
import {
  createTestStorageRoot,
  grantTestLicense,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

let fixtures: Fixtures
let cookie: string
let app: Awaited<ReturnType<typeof buildApp>>

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerJsonBodyParser } = await import("../../apps/api/src/plugins/json-body")
  const { registerSettingsRoutes } = await import("../../apps/api/src/modules/settings/routes")
  const a = Fastify({ logger: false })
  a.decorate("prisma", prisma)
  a.decorate("redis", { incr: async () => 1, expire: async () => 1, get: async () => null, del: async () => 1, set: async () => "OK" })
  a.decorate("publishRealtimeEvent", async () => {})
  registerJsonBodyParser(a)
  await registerCookies(a)
  await a.register(async (api) => registerSettingsRoutes(api), { prefix: "/api" })
  await a.ready()
  return a
}

async function setOwnerMfa(enabled: boolean) {
  await prisma.user.update({
    where: { id: fixtures.user.id },
    data: { mfaEnabledAt: enabled ? new Date() : null },
  })
}

beforeAll(async () => {
  const root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
  // ops.remote_access_helper is a paid feature; the policy, not the gate, is under test.
  await grantTestLicense(root)
  const raw = `sess_${crypto.randomUUID()}`
  await prisma.session.create({
    data: { userId: fixtures.user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) },
  })
  cookie = `arciin_session=${raw}`
  app = await buildApp()
})

afterAll(async () => {
  const { stopCloudflareQuickTunnel } = await import("../../apps/api/src/services/remote-access/cloudflare-tunnel")
  stopCloudflareQuickTunnel()
  await app?.close()
  await prisma.instanceConfig.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

beforeEach(() => {
  spawned.length = 0
})

afterEach(async () => {
  const { stopCloudflareQuickTunnel } = await import("../../apps/api/src/services/remote-access/cloudflare-tunnel")
  stopCloudflareQuickTunnel()
})

const START_ROUTES = ["/api/settings/cloudflare-tunnel/start", "/api/settings/cloudflare-tunnel/start-mobile"]

describe("owner without MFA", () => {
  beforeEach(() => setOwnerMfa(false))

  it.each(START_ROUTES)("%s → 403 OWNER_MFA_REQUIRED, nothing spawned, no hostname", async (url) => {
    const res = await app.inject({ method: "POST", url, headers: { cookie }, payload: {} })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("OWNER_MFA_REQUIRED")
    expect(res.body).not.toContain("trycloudflare.com")
    expect(spawned).toEqual([])
    const { getCloudflareTunnelState } = await import("../../apps/api/src/services/remote-access/cloudflare-tunnel")
    expect(getCloudflareTunnelState().running).toBe(false)
  })

  it("enabling the tunnel in Remote Access settings is refused too, and nothing is saved or started", async () => {
    const before = await prisma.instanceConfig.findFirstOrThrow()
    const res = await app.inject({
      method: "PATCH",
      url: "/api/settings/remote-access",
      headers: { cookie },
      payload: { mode: "cloudflare-tunnel", cloudflareTunnelEnabled: true, cloudflareTunnelAutoStart: true },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("OWNER_MFA_REQUIRED")
    const after = await prisma.instanceConfig.findFirstOrThrow()
    expect(after.remoteAccessConfig).toEqual(before.remoteAccessConfig)
    await new Promise((r) => setTimeout(r, 3_500)) // requestCloudflareTunnelStart waits 3s
    expect(spawned).toEqual([])
  })

  it("the service choke point refuses before spawning, whoever calls it (boot, restart, future routes)", async () => {
    const { startPublicTunnel, PublicRemoteAccessDeniedError } = await import(
      "../../apps/api/src/services/remote-access/public-tunnel"
    )
    await expect(startPublicTunnel(prisma, "http://127.0.0.1:3100")).rejects.toBeInstanceOf(
      PublicRemoteAccessDeniedError,
    )
    expect(spawned).toEqual([])
  })

  it("LAN use is untouched: the owner still reaches settings and can save non-public options", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings/remote-access", headers: { cookie } })
    expect(res.statusCode).toBe(200)
    const save = await app.inject({
      method: "PATCH",
      url: "/api/settings/remote-access",
      headers: { cookie },
      payload: { cloudflareTunnelEnabled: false },
    })
    expect(save.statusCode).toBe(200)
    // Closing the door is never blocked.
    const stop = await app.inject({ method: "POST", url: "/api/settings/cloudflare-tunnel/stop", headers: { cookie } })
    expect(stop.statusCode).toBe(200)
  })
})

describe("owner with MFA enrolled", () => {
  beforeEach(() => setOwnerMfa(true))

  it.each(START_ROUTES)("%s passes the policy and starts the tunnel (spawn intercepted)", async (url) => {
    const res = await app.inject({ method: "POST", url, headers: { cookie }, payload: {} })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.publicUrl).toBe("https://fake-policy-test.trycloudflare.com")
    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.cmd).toBe("cloudflared")
    // Isolated quick-tunnel config — never the licensing tunnel's ~/.cloudflared/config.yml.
    expect(spawned[0]!.args.join(" ")).not.toContain(".cloudflared/config.yml")
    expect(spawned[0]!.args).toContain("--config")
  })

  it("no TOTP code is demanded per start — enrolment is the requirement", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/settings/cloudflare-tunnel/start-mobile",
      headers: { cookie },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
  })
})
