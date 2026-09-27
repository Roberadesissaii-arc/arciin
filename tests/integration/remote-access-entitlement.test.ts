import { EventEmitter } from "node:events"

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Public Remote Access is a paid feature — on every path, not only the button.
 *
 * Production showed a Free instance with a live quick tunnel: the Generate URL
 * route checked the plan, but the boot auto-start went through the shared
 * choke point, which only checked the owner's MFA. These pin the plan check
 * into that choke point, the lifecycle that closes a tunnel when the plan
 * lapses, and the status the Domain page reads so it cannot show a dead or
 * unpaid tunnel as live.
 *
 * `node:child_process` is mocked: nothing here starts a real cloudflared or
 * reaches the network. Each spawn and kill is recorded, so "no tunnel" is an
 * assertion about calls.
 */

const spawned: Array<{ cmd: string; args: string[]; pid: number }> = []
const killed: number[] = []
let nextPid = 500_000

const ISOLATED_TARGET = "http://127.0.0.1:59999"
const QUICK_URL = "https://fake-entitlement-test.trycloudflare.com"

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return {
    ...actual,
    spawn: (cmd: string, args: string[]) => {
      const pid = nextPid++
      spawned.push({ cmd, args, pid })
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        kill: () => boolean
        pid: number
        exitCode: number | null
        killed: boolean
      }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.pid = pid
      child.exitCode = null
      child.killed = false
      child.kill = () => {
        killed.push(child.pid)
        child.killed = true
        return true
      }
      setTimeout(() => child.stderr.emit("data", Buffer.from(`INF |  ${QUICK_URL}  |`)), 5)
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
let root: string
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

type LicenseState = "free" | "pro" | "team" | "business" | "expired-pro" | "revoked" | "tampered"

/** Put the instance into a license state the way the license service would leave it. */
async function setLicense(state: LicenseState) {
  if (state === "pro" || state === "team" || state === "business") {
    await grantTestLicense(root, state)
    return
  }
  const { buildHostedTokenPayload, parseLicensePrivateKey, signHostedLicenseToken } = await import("@arciin/config")
  await grantTestLicense(root, "pro")
  const instance = await prisma.instanceConfig.findFirstOrThrow()
  if (state === "free") {
    await prisma.instanceConfig.update({
      where: { id: instance.id },
      data: { licensePlan: "free", licenseStatus: "none", licenseSignedToken: null, licenseSource: "default", licenseExpiresAt: null, licenseGraceUntil: null },
    })
  } else if (state === "expired-pro") {
    // A Pro token whose paid period and grace have both ended.
    const past = new Date(Date.now() - 40 * 86_400_000)
    const graceOver = new Date(Date.now() - 30 * 86_400_000)
    await prisma.instanceConfig.update({
      where: { id: instance.id },
      data: {
        licenseExpiresAt: past,
        licenseGraceUntil: graceOver,
        licenseSignedToken: signHostedLicenseToken(
          buildHostedTokenPayload({
            licenseId: "lic_expired",
            plan: "pro",
            status: "active",
            instanceId: instance.id,
            serverLimit: 1,
            keyPrefix: "ARC_TST…0002",
            expiresAt: past,
            graceUntil: graceOver,
          }),
          parseLicensePrivateKey("P1L5nJPd7wq0kUwqhU7SbXe0P4H2fT1YtGxWvBoNsRA"),
          "arciin-lic-test",
        ),
      },
    })
  } else if (state === "revoked") {
    // What refreshLicense writes when the authority answers LICENSE_REVOKED.
    await prisma.instanceConfig.update({
      where: { id: instance.id },
      data: { licensePlan: "free", licenseStatus: "expired", licenseSignedToken: null, licenseSource: "hosted" },
    })
  } else if (state === "tampered") {
    // The row claims Pro, but the signed token does not verify.
    const token = instance.licenseSignedToken!
    await prisma.instanceConfig.update({
      where: { id: instance.id },
      data: { licenseSignedToken: `${token.slice(0, -6)}AAAAAA` },
    })
  }
}

async function setOwnerMfa(enabled: boolean) {
  await prisma.user.update({ where: { id: fixtures.user.id }, data: { mfaEnabledAt: enabled ? new Date() : null } })
}

async function tunnelModule() {
  return import("../../apps/api/src/services/remote-access/cloudflare-tunnel")
}

beforeAll(async () => {
  process.env.ARCIIN_TUNNEL_TARGET = ISOLATED_TARGET
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
    if (url.startsWith(`${ISOLATED_TARGET}/`) || url.startsWith(QUICK_URL)) {
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    }
    throw new Error(`test attempted a real network call: ${url}`)
  })
  root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
  await grantTestLicense(root, "pro")
  const raw = `sess_${crypto.randomUUID()}`
  await prisma.session.create({
    data: { userId: fixtures.user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) },
  })
  cookie = `arciin_session=${raw}`
  app = await buildApp()
})

afterAll(async () => {
  vi.unstubAllGlobals()
  delete process.env.ARCIIN_TUNNEL_TARGET
  ;(await tunnelModule()).stopCloudflareQuickTunnel()
  await app?.close()
  await prisma.instanceConfig.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

beforeEach(async () => {
  ;(await tunnelModule()).stopCloudflareQuickTunnel()
  spawned.length = 0
  killed.length = 0
  await setOwnerMfa(true)
})

describe("one canonical entitlement", () => {
  it.each<[LicenseState, boolean]>([
    ["free", false],
    ["pro", true],
    ["team", true],
    ["business", true],
    ["expired-pro", false],
    ["revoked", false],
    ["tampered", false],
  ])("%s → public Remote Access %s", async (state, entitled) => {
    await setLicense(state)
    const { readRemoteAccessEntitlement } = await import("../../apps/api/src/services/remote-access/public-tunnel")
    const answer = await readRemoteAccessEntitlement(prisma)
    expect(answer.entitled).toBe(entitled)
    expect(answer.requiredPlans).toEqual(["pro", "team", "business"])
  })
})

describe("Free and lapsed plans cannot open a tunnel by any path", () => {
  it.each<LicenseState>(["free", "expired-pro", "revoked", "tampered"])(
    "%s: Generate URL, mobile start, Settings enable and the boot/restart choke point all refuse, and nothing spawns",
    async (state) => {
      await setLicense(state)
      for (const url of ["/api/settings/cloudflare-tunnel/start", "/api/settings/cloudflare-tunnel/start-mobile"]) {
        const res = await app.inject({ method: "POST", url, headers: { cookie } })
        expect(res.statusCode, url).toBe(403)
        expect(res.json().error.code, url).toBe("LICENSE_REQUIRED")
      }

      const before = await prisma.instanceConfig.findFirstOrThrow()
      const enable = await app.inject({
        method: "PATCH",
        url: "/api/settings/remote-access",
        headers: { cookie },
        payload: { cloudflareTunnelEnabled: true, mode: "cloudflare-tunnel" },
      })
      expect(enable.statusCode).toBe(403)
      expect(enable.json().error.code).toBe("LICENSE_REQUIRED")
      expect((await prisma.instanceConfig.findFirstOrThrow()).remoteAccessConfig).toEqual(before.remoteAccessConfig)

      // Boot auto-start and restart-after-exit call this, not a route.
      const { startPublicTunnel, PublicRemoteAccessDeniedError } = await import(
        "../../apps/api/src/services/remote-access/public-tunnel"
      )
      const err = await startPublicTunnel(prisma, ISOLATED_TARGET).catch((e) => e)
      expect(err).toBeInstanceOf(PublicRemoteAccessDeniedError)
      expect(err.code).toBe("LICENSE_REQUIRED")
      expect(spawned).toEqual([])
    },
  )

  it("LAN settings still load and save on Free", async () => {
    await setLicense("free")
    const read = await app.inject({ method: "GET", url: "/api/settings/remote-access", headers: { cookie } })
    expect(read.statusCode).toBe(200)
    expect(read.json().data.publicRemoteAccess).toMatchObject({ entitled: false, plan: "free" })
    const save = await app.inject({
      method: "PATCH",
      url: "/api/settings/remote-access",
      headers: { cookie },
      payload: { reverseProxyEnabled: false },
    })
    expect(save.statusCode).toBe(200)
  })
})

describe("paid plans", () => {
  it.each<LicenseState>(["pro", "team", "business"])("%s with owner MFA can start the tunnel", async (plan) => {
    await setLicense(plan)
    const res = await app.inject({ method: "POST", url: "/api/settings/cloudflare-tunnel/start", headers: { cookie } })
    expect(res.statusCode, res.body).toBe(200)
    expect(spawned).toHaveLength(1)
  })

  it("the owner's second factor is still required when the plan allows it", async () => {
    await setLicense("pro")
    await setOwnerMfa(false)
    const res = await app.inject({ method: "POST", url: "/api/settings/cloudflare-tunnel/start", headers: { cookie } })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("OWNER_MFA_REQUIRED")
    expect(spawned).toEqual([])
  })
})

describe("the plan lapsing closes the tunnel", () => {
  it("a downgrade stops Arciin's quick tunnel, forgets its address, and does not restart it", async () => {
    await setLicense("pro")
    const start = await app.inject({ method: "POST", url: "/api/settings/cloudflare-tunnel/start", headers: { cookie } })
    expect(start.statusCode, start.body).toBe(200)
    await prisma.instanceConfig.updateMany({
      data: { publicUrl: QUICK_URL, remoteAccessConfig: { cloudflareTunnelEnabled: true, cloudflareTunnelAutoStart: true, mobilePublicUrl: QUICK_URL } },
    })
    const { getCloudflareTunnelState } = await tunnelModule()
    expect(getCloudflareTunnelState().running).toBe(true)
    const ourPid = spawned[0]!.pid

    // Downgrade in place, exactly as refreshLicense does when the authority
    // answers revoked/expired — the rest of the row (and its settings) stays.
    await prisma.instanceConfig.updateMany({
      data: { licensePlan: "free", licenseStatus: "expired", licenseSignedToken: null },
    })
    // What the Domain page polls: it reconciles before answering.
    const status = await app.inject({ method: "GET", url: "/api/settings/cloudflare-tunnel", headers: { cookie } })
    expect(status.statusCode).toBe(200)
    const data = status.json().data
    expect(data.running).toBe(false)
    expect(data.url).toBeNull()
    expect(data.publicRemoteAccess.entitled).toBe(false)
    expect(data.publicUrl).toBeNull()
    expect(data.mobilePublicUrl).toBeNull()
    // Only the process this API spawned was signalled — never anything else.
    expect(killed).toEqual([ourPid])

    // The preference survives so an upgrade needs nothing re-entered…
    const stored = await prisma.instanceConfig.findFirstOrThrow()
    expect((stored.remoteAccessConfig as Record<string, unknown>).cloudflareTunnelEnabled).toBe(true)
    // …and no restart is attempted while the plan is missing.
    await new Promise((r) => setTimeout(r, 50))
    expect(spawned).toHaveLength(1)
  })

  it("a custom public domain the owner entered is theirs and is kept", async () => {
    await setLicense("free")
    await prisma.instanceConfig.updateMany({ data: { publicUrl: "https://files.example.com" } })
    const read = await app.inject({ method: "GET", url: "/api/settings/remote-access", headers: { cookie } })
    expect(read.json().data.publicUrl).toBe("https://files.example.com")
    await prisma.instanceConfig.updateMany({ data: { publicUrl: null } })
  })

  it("a stale trycloudflare address is never presented on Free", async () => {
    await setLicense("free")
    await prisma.instanceConfig.updateMany({
      data: { publicUrl: QUICK_URL, remoteAccessConfig: { cloudflareTunnelEnabled: true, mobilePublicUrl: QUICK_URL } },
    })
    const read = await app.inject({ method: "GET", url: "/api/settings/remote-access", headers: { cookie } })
    const data = read.json().data
    expect(data.publicUrl).toBeNull()
    expect(data.mobilePublicUrl).toBeNull()
    expect(data.currentUrl).not.toBe(QUICK_URL)
  })

  it("upgrading again unlocks the controls with nothing to reinstall", async () => {
    await setLicense("free")
    const locked = await app.inject({ method: "GET", url: "/api/settings/remote-access", headers: { cookie } })
    expect(locked.json().data.publicRemoteAccess.entitled).toBe(false)
    await setLicense("team")
    const open = await app.inject({ method: "GET", url: "/api/settings/remote-access", headers: { cookie } })
    expect(open.json().data.publicRemoteAccess).toMatchObject({ entitled: true, plan: "team" })
    const start = await app.inject({ method: "POST", url: "/api/settings/cloudflare-tunnel/start", headers: { cookie } })
    expect(start.statusCode, start.body).toBe(200)
  })
})
