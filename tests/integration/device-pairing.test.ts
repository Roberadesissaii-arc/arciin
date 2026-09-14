import Redis from "ioredis"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { TRUSTED_DEVICE_COOKIE_NAME } from "@arciin/config"

import { hashPassword, hashToken } from "../../apps/api/src/services/security/auth"
import {
  claimDevicePairing,
  createDevicePairing,
  findActiveDeviceByCredential,
  generateDeviceCredential,
  hashDeviceCredential,
  issueDeviceSession,
  revokeDevice,
  touchDeviceLastSeen,
} from "../../apps/api/src/services/devices/pairing"
import {
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
} from "./setup"

let redis: Redis
let ownerId: string
let adminId: string
let memberId: string
let viewerId: string

function stubRedis() {
  return {
    incr: async () => 1,
    expire: async () => 1,
    get: async () => null,
    del: async () => 1,
  }
}

async function seedUser(input: {
  email: string
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER"
}) {
  return prisma.user.create({
    data: {
      name: input.email.split("@")[0] ?? "User",
      email: input.email,
      passwordHash: await hashPassword("TestPass123!"),
      role: input.role,
      status: "ACTIVE",
    },
  })
}

async function sessionToken(userId: string, pairedDeviceId?: string) {
  const raw = `sess_${userId}_${crypto.randomUUID()}`
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      pairedDeviceId: pairedDeviceId ?? null,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  })
  return raw
}

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const {
    registerDeviceClientRoutes,
    registerDeviceDiscoverAlias,
    registerDiscoveryRoutes,
  } = await import("../../apps/api/src/modules/devices/routes")
  const { registerDeviceSettingsRoutes } = await import(
    "../../apps/api/src/modules/devices/settings-routes"
  )
  const { registerAuthRoutes } = await import("../../apps/api/src/modules/auth/routes")
  const app = Fastify({ logger: false })
  app.decorate("prisma", prisma)
  app.decorate("redis", stubRedis())
  await registerCookies(app)
  await registerDiscoveryRoutes(app)
  await app.register(async (api) => {
    await registerDeviceDiscoverAlias(api)
    await registerDeviceClientRoutes(api)
    await registerDeviceSettingsRoutes(api)
    await registerAuthRoutes(api)
  }, { prefix: "/api" })
  await app.ready()
  return app
}

beforeAll(async () => {
  const root = await createTestStorageRoot()
  await resetDatabase()
  const fixtures = await seedBaseFixtures(root)
  ownerId = fixtures.user.id
  await prisma.user.update({
    where: { id: ownerId },
    data: { passwordHash: await hashPassword("TestPass123!") },
  })
  adminId = (await seedUser({ email: "devices-admin@test.invalid", role: "ADMIN" })).id
  memberId = (await seedUser({ email: "devices-member@test.invalid", role: "MEMBER" })).id
  viewerId = (await seedUser({ email: "devices-viewer@test.invalid", role: "VIEWER" })).id
  await prisma.instanceConfig.deleteMany()
  await prisma.instanceConfig.create({
    data: {
      instanceName: "Arciin Home",
      storageRoot: fixtures.storageLocation.rootPath,
      initializedAt: new Date(),
      licensePlan: "free",
      licenseStatus: "none",
    },
  })
  redis = new Redis(process.env.REDIS_URL!)
})

afterAll(async () => {
  await resetDatabase()
  await prisma.instanceConfig.deleteMany()
  await removeTestStorageRoot()
  await redis.quit()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.deviceSession.deleteMany()
  await prisma.devicePairing.deleteMany()
  await prisma.session.deleteMany()
  await prisma.device.deleteMany()
})

describe("discovery", () => {
  it("returns a minimal public manifest", async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({ method: "GET", url: "/.well-known/arciin" })
      expect(res.statusCode).toBe(200)
      const alias = await app.inject({ method: "GET", url: "/api/.well-known/arciin" })
      expect(alias.statusCode).toBe(200)
      const body = res.json()
      expect(alias.json().serverId).toBe(body.serverId)
      expect(body.service).toBe("arciin")
      expect(body.protocolVersion).toBe(1)
      expect(body.pairingSupported).toBe(true)
      expect(body.pairingAvailable).toBe(true)
      expect(body.instanceName).toBe("Arciin Home")
      expect(body.serverId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
      expect(JSON.stringify(body)).not.toMatch(/email|storageRoot|licenseSignedToken|setupToken|REDIS|users/i)
      expect(body).not.toHaveProperty("data")
    } finally {
      await app.close()
    }
  })
})

describe("pairing creation authorization", () => {
  it("rejects unauthenticated, member, and viewer; allows admin and owner", async () => {
    const app = await buildApp()
    try {
      const anon = await app.inject({ method: "POST", url: "/api/settings/devices/pairing" })
      expect(anon.statusCode).toBe(401)

      for (const [id, status] of [
        [memberId, 403],
        [viewerId, 403],
        [adminId, 201],
        [ownerId, 201],
      ] as const) {
        const token = await sessionToken(id)
        const res = await app.inject({
          method: "POST",
          url: "/api/settings/devices/pairing",
          headers: { authorization: `Bearer ${token}` },
        })
        expect(res.statusCode).toBe(status)
        if (status === 201) {
          expect(res.json().data.code).toMatch(/^\d{6}$/)
          expect(res.json().data.displayCode).toMatch(/^\d{3} \d{3}$/)
          const stored = await prisma.devicePairing.findMany({ where: { status: "PENDING" } })
          expect(stored).toHaveLength(1)
          expect(stored[0]?.codeHash).not.toBe(res.json().data.code)
          expect(stored[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000)
        }
      }
    } finally {
      await app.close()
    }
  })

  it("cancels the previous pending code when a new one is generated", async () => {
    const first = await createDevicePairing(prisma, ownerId)
    const second = await createDevicePairing(prisma, ownerId)
    const rows = await prisma.devicePairing.findMany({ orderBy: { createdAt: "asc" } })
    expect(rows).toHaveLength(2)
    expect(rows[0]?.status).toBe("CANCELLED")
    expect(rows[1]?.id).toBe(second.id)
    expect(first.code).not.toBe(second.code)
  })
})

describe("pairing attacks", () => {
  it("rejects wrong, expired, cancelled, and reused codes", async () => {
    const created = await createDevicePairing(prisma, ownerId)
    await expect(
      claimDevicePairing(prisma, {
        code: "000000",
        name: "Nope",
        platform: "windows",
        deviceType: "desktop",
        protocolVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "PAIRING_CODE_INVALID" })

    await prisma.devicePairing.updateMany({
      where: { status: "PENDING" },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    await expect(
      claimDevicePairing(prisma, {
        code: created.code,
        name: "Late",
        platform: "windows",
        deviceType: "desktop",
        protocolVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "PAIRING_CODE_EXPIRED" })

    const next = await createDevicePairing(prisma, ownerId)
    await prisma.devicePairing.updateMany({
      where: { id: (await prisma.devicePairing.findFirstOrThrow({ where: { status: "PENDING" } })).id },
      data: { status: "CANCELLED" },
    })
    await expect(
      claimDevicePairing(prisma, {
        code: next.code,
        name: "Cancelled",
        platform: "windows",
        deviceType: "desktop",
        protocolVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "PAIRING_CODE_INVALID" })

    const usable = await createDevicePairing(prisma, ownerId)
    await claimDevicePairing(prisma, {
      code: usable.code,
      name: "Once",
      platform: "linux",
      deviceType: "desktop",
      protocolVersion: 1,
    })
    await expect(
      claimDevicePairing(prisma, {
        code: usable.code,
        name: "Twice",
        platform: "linux",
        deviceType: "desktop",
        protocolVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "PAIRING_ALREADY_USED" })
  })

  it("locks the pairing after five failed attempts", async () => {
    const created = await createDevicePairing(prisma, ownerId)
    for (let i = 0; i < 4; i++) {
      await expect(
        claimDevicePairing(prisma, {
          code: "111111",
          name: "Attack",
          platform: "windows",
          deviceType: "desktop",
          protocolVersion: 1,
        }),
      ).rejects.toMatchObject({ code: "PAIRING_CODE_INVALID" })
    }
    await expect(
      claimDevicePairing(prisma, {
        code: "111111",
        name: "Attack",
        platform: "windows",
        deviceType: "desktop",
        protocolVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "PAIRING_CODE_LOCKED" })
    await expect(
      claimDevicePairing(prisma, {
        code: created.code,
        name: "Too late",
        platform: "windows",
        deviceType: "desktop",
        protocolVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "PAIRING_CODE_INVALID" })
  })

  it("allows only one winner on a simultaneous claim", async () => {
    const created = await createDevicePairing(prisma, ownerId)
    const results = await Promise.allSettled([
      claimDevicePairing(prisma, {
        code: created.code,
        name: "First",
        platform: "windows",
        deviceType: "desktop",
        protocolVersion: 1,
      }),
      claimDevicePairing(prisma, {
        code: created.code,
        name: "Second",
        platform: "macos",
        deviceType: "laptop",
        protocolVersion: 1,
      }),
    ])
    const wins = results.filter((r) => r.status === "fulfilled")
    const losses = results.filter((r) => r.status === "rejected")
    expect(wins).toHaveLength(1)
    expect(losses).toHaveLength(1)
    expect(await prisma.device.count()).toBe(1)
  })

  it("enforces the pair endpoint rate limit", async () => {
    const Fastify = (await import("fastify")).default
    const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
    const { registerDeviceClientRoutes } = await import(
      "../../apps/api/src/modules/devices/routes"
    )
    const app = Fastify({ logger: false })
    app.decorate("prisma", prisma)
    app.decorate("redis", redis)
    await registerCookies(app)
    await registerDeviceClientRoutes(app)
    await app.ready()
    try {
      let limited = 0
      for (let i = 0; i < 12; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/devices/pair",
          payload: {
            code: "000000",
            name: "Flood",
            platform: "windows",
            deviceType: "desktop",
            protocolVersion: 1,
          },
        })
        if (res.statusCode === 429) limited += 1
      }
      expect(limited).toBeGreaterThan(0)
    } finally {
      await app.close()
    }
  })
})

describe("successful pairing and device auth", () => {
  it("creates an ACTIVE device, returns the credential once, and stores only a hash", async () => {
    const created = await createDevicePairing(prisma, ownerId)
    const claimed = await claimDevicePairing(prisma, {
      code: created.code,
      name: "Robera Desktop",
      platform: "windows",
      deviceType: "desktop",
      appVersion: "0.1.0",
      protocolVersion: 1,
    })
    expect(claimed.device.status).toBe("ACTIVE")
    expect(claimed.credential.length).toBeGreaterThan(32)
    const row = await prisma.device.findUniqueOrThrow({ where: { id: claimed.device.id } })
    expect(row.credentialHash).toBe(hashDeviceCredential(claimed.credential))
    expect(JSON.stringify(row)).not.toContain(claimed.credential)
    const pairing = await prisma.devicePairing.findFirstOrThrow()
    expect(pairing.status).toBe("CLAIMED")
    expect(pairing.claimedByDeviceId).toBe(row.id)
  })

  it("accepts a valid device credential and rejects invalid or revoked ones", async () => {
    const created = await createDevicePairing(prisma, ownerId)
    const claimed = await claimDevicePairing(prisma, {
      code: created.code,
      name: "Office",
      platform: "linux",
      deviceType: "desktop",
      protocolVersion: 1,
    })
    const live = await findActiveDeviceByCredential(prisma, claimed.credential)
    expect(live.id).toBe(claimed.device.id)

    await expect(findActiveDeviceByCredential(prisma, generateDeviceCredential())).rejects.toMatchObject({
      code: "DEVICE_INVALID",
    })

    await revokeDevice(prisma, claimed.device.id)
    await expect(findActiveDeviceByCredential(prisma, claimed.credential)).rejects.toMatchObject({
      code: "DEVICE_REVOKED",
    })
  })

  it("throttles lastSeen writes", async () => {
    const created = await createDevicePairing(prisma, ownerId)
    const claimed = await claimDevicePairing(prisma, {
      code: created.code,
      name: "Seen",
      platform: "macos",
      deviceType: "laptop",
      protocolVersion: 1,
    })
    const first = new Date("2026-01-01T00:00:00.000Z")
    await prisma.device.update({
      where: { id: claimed.device.id },
      data: { lastSeenAt: first },
    })
    await touchDeviceLastSeen(prisma, claimed.device.id, new Date())
    const unchanged = await prisma.device.findUniqueOrThrow({ where: { id: claimed.device.id } })
    expect(unchanged.lastSeenAt?.toISOString()).toBe(first.toISOString())

    await touchDeviceLastSeen(prisma, claimed.device.id, new Date(Date.now() - 6 * 60_000))
    const updated = await prisma.device.findUniqueOrThrow({ where: { id: claimed.device.id } })
    expect(updated.lastSeenAt && updated.lastSeenAt.getTime()).toBeGreaterThan(first.getTime())
  })

  it("rejects an unsupported protocol version", async () => {
    const created = await createDevicePairing(prisma, ownerId)
    await expect(
      claimDevicePairing(prisma, {
        code: created.code,
        name: "Old client",
        platform: "windows",
        deviceType: "desktop",
        protocolVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "DEVICE_PROTOCOL_UNSUPPORTED" })
  })

  it("bootstraps a trusted-device cookie without creating a user session", async () => {
    const created = await createDevicePairing(prisma, ownerId)
    const claimed = await claimDevicePairing(prisma, {
      code: created.code,
      name: "Cookie Desktop",
      platform: "windows",
      deviceType: "desktop",
      protocolVersion: 1,
    })
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/devices/session",
        headers: { authorization: `Device ${claimed.credential}` },
      })
      expect(res.statusCode).toBe(200)
      expect(res.json().data.device.status).toBe("ACTIVE")
      expect(res.headers["set-cookie"]?.toString()).toContain(TRUSTED_DEVICE_COOKIE_NAME)
      expect(await prisma.session.count()).toBe(0)
    } finally {
      await app.close()
    }
  })
})

describe("user login and revocation", () => {
  it("keeps normal browser login unbound and binds a trusted-device login", async () => {
    const app = await buildApp()
    try {
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email: owner.email, password: "TestPass123!" },
      })
      expect(login.statusCode).toBe(200)
      const unbound = await prisma.session.findFirstOrThrow()
      expect(unbound.pairedDeviceId).toBeNull()

      const created = await createDevicePairing(prisma, ownerId)
      const claimed = await claimDevicePairing(prisma, {
        code: created.code,
        name: "Bound Desktop",
        platform: "windows",
        deviceType: "desktop",
        protocolVersion: 1,
      })
      const { rawToken } = await issueDeviceSession(prisma, claimed.device)
      await prisma.session.deleteMany()
      const boundLogin = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { cookie: `${TRUSTED_DEVICE_COOKIE_NAME}=${rawToken}` },
        payload: { email: owner.email, password: "TestPass123!" },
      })
      expect(boundLogin.statusCode).toBe(200)
      const bound = await prisma.session.findFirstOrThrow()
      expect(bound.pairedDeviceId).toBe(claimed.device.id)
    } finally {
      await app.close()
    }
  })

  it("lets owner/admin revoke and forbids member/viewer; invalidates only bound sessions", async () => {
    const created = await createDevicePairing(prisma, ownerId)
    const claimed = await claimDevicePairing(prisma, {
      code: created.code,
      name: "Revoke Me",
      platform: "windows",
      deviceType: "desktop",
      protocolVersion: 1,
    })
    const boundToken = await sessionToken(ownerId, claimed.device.id)
    const browserToken = await sessionToken(ownerId)

    const app = await buildApp()
    try {
      const member = await app.inject({
        method: "POST",
        url: `/api/settings/devices/${claimed.device.id}/revoke`,
        headers: { authorization: `Bearer ${await sessionToken(memberId)}` },
      })
      expect(member.statusCode).toBe(403)

      const viewer = await app.inject({
        method: "POST",
        url: `/api/settings/devices/${claimed.device.id}/revoke`,
        headers: { authorization: `Bearer ${await sessionToken(viewerId)}` },
      })
      expect(viewer.statusCode).toBe(403)

      const admin = await app.inject({
        method: "POST",
        url: `/api/settings/devices/${claimed.device.id}/revoke`,
        headers: { authorization: `Bearer ${await sessionToken(adminId)}` },
      })
      expect(admin.statusCode).toBe(200)

      const device = await prisma.device.findUniqueOrThrow({ where: { id: claimed.device.id } })
      expect(device.status).toBe("REVOKED")
      expect(await prisma.session.findFirst({ where: { tokenHash: hashToken(boundToken) } })).toBeNull()
      expect(await prisma.session.findFirst({ where: { tokenHash: hashToken(browserToken) } })).not.toBeNull()
      await expect(findActiveDeviceByCredential(prisma, claimed.credential)).rejects.toMatchObject({
        code: "DEVICE_REVOKED",
      })
    } finally {
      await app.close()
    }
  })
})

describe("GET /api/auth/me session device binding", () => {
  type MeBody = {
    data: {
      user: { id: string; role: string }
      session: { pairedDeviceId: string | null } | null
    }
  }

  it("returns null pairedDeviceId for a normal browser session", async () => {
    const token = await sessionToken(ownerId)
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { arciin_session: token },
      })
      expect(res.statusCode).toBe(200)
      expect((res.json() as MeBody).data.session?.pairedDeviceId).toBeNull()
    } finally {
      await app.close()
    }
  })

  it("returns the bound Device.id for a device-bound session", async () => {
    const created = await createDevicePairing(prisma, ownerId)
    const claimed = await claimDevicePairing(prisma, {
      code: created.code,
      name: "Bound Me",
      platform: "windows",
      deviceType: "desktop",
      protocolVersion: 1,
    })
    const token = await sessionToken(ownerId, claimed.device.id)
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { arciin_session: token },
      })
      expect(res.statusCode).toBe(200)
      expect((res.json() as MeBody).data.session?.pairedDeviceId).toBe(claimed.device.id)
    } finally {
      await app.close()
    }
  })

  it("lets a MEMBER read their own session binding", async () => {
    const created = await createDevicePairing(prisma, ownerId)
    const claimed = await claimDevicePairing(prisma, {
      code: created.code,
      name: "Member Desktop",
      platform: "windows",
      deviceType: "desktop",
      protocolVersion: 1,
    })
    const unbound = await sessionToken(memberId)
    const bound = await sessionToken(memberId, claimed.device.id)
    const app = await buildApp()
    try {
      const forbidden = await app.inject({
        method: "GET",
        url: "/api/settings/devices",
        cookies: { arciin_session: bound },
      })
      expect(forbidden.statusCode).toBe(403)

      const browserMe = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { arciin_session: unbound },
      })
      expect(browserMe.statusCode).toBe(200)
      const browserBody = browserMe.json() as MeBody
      expect(browserBody.data.user.role).toBe("MEMBER")
      expect(browserBody.data.session?.pairedDeviceId).toBeNull()

      const boundMe = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { arciin_session: bound },
      })
      expect(boundMe.statusCode).toBe(200)
      expect((boundMe.json() as MeBody).data.session?.pairedDeviceId).toBe(claimed.device.id)
    } finally {
      await app.close()
    }
  })

  it("ignores client-supplied pairedDeviceId, User-Agent, and hostname", async () => {
    const token = await sessionToken(ownerId)
    const spoofId = "dev_client_supplied_should_be_ignored"
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "GET",
        url: `/api/auth/me?pairedDeviceId=${spoofId}`,
        headers: {
          "user-agent": "ArciinDesktop/1.0 (DESKTOP-SPOOF)",
          "x-paired-device-id": spoofId,
          "x-device-id": spoofId,
          "x-arciin-device-id": spoofId,
          "x-forwarded-host": "desktop-spoof.local",
        },
        cookies: { arciin_session: token },
      })
      expect(res.statusCode).toBe(200)
      const body = res.json() as MeBody
      expect(body.data.session?.pairedDeviceId).toBeNull()
      expect(JSON.stringify(body)).not.toContain(spoofId)

      const owner = await prisma.user.findUniqueOrThrow({ where: { id: ownerId } })
      await prisma.session.deleteMany()
      const login = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: owner.email,
          password: "TestPass123!",
          pairedDeviceId: spoofId,
          currentDeviceId: spoofId,
        },
      })
      expect(login.statusCode).toBe(200)
      expect(login.json().data.session.pairedDeviceId).toBeNull()
      const stored = await prisma.session.findFirstOrThrow()
      expect(stored.pairedDeviceId).toBeNull()
    } finally {
      await app.close()
    }
  })
})

describe("current paired device on Settings → Devices", () => {
  async function pairNamed(name: string) {
    const created = await createDevicePairing(prisma, ownerId)
    return claimDevicePairing(prisma, {
      code: created.code,
      name,
      platform: "windows",
      deviceType: "desktop",
      protocolVersion: 1,
    })
  }

  it("identifies the session device and leaves a browser session without one", async () => {
    const current = await pairNamed("Robera Desktop")
    const other = await pairNamed("Office Laptop")
    const bound = await sessionToken(ownerId, current.device.id)
    const browser = await sessionToken(ownerId)
    const app = await buildApp()
    try {
      const fromDesktop = await app.inject({
        method: "GET",
        url: "/api/settings/devices",
        cookies: { arciin_session: bound },
      })
      expect(fromDesktop.statusCode).toBe(200)
      const desktopData = fromDesktop.json().data as {
        currentDeviceId: string | null
        devices: Array<{ id: string; name: string; isCurrentDevice: boolean }>
      }
      expect(desktopData.currentDeviceId).toBe(current.device.id)
      expect(desktopData.devices.find((device) => device.id === current.device.id)?.isCurrentDevice).toBe(true)
      expect(desktopData.devices.find((device) => device.id === other.device.id)?.isCurrentDevice).toBe(false)

      const fromBrowser = await app.inject({
        method: "GET",
        url: "/api/settings/devices",
        cookies: { arciin_session: browser },
      })
      expect(fromBrowser.statusCode).toBe(200)
      const browserData = fromBrowser.json().data as {
        currentDeviceId: string | null
        devices: Array<{ isCurrentDevice: boolean }>
      }
      expect(browserData.currentDeviceId).toBeNull()
      expect(browserData.devices.every((device) => device.isCurrentDevice === false)).toBe(true)
    } finally {
      await app.close()
    }
  })

  it("revoking the current device leaves an unrelated device trusted", async () => {
    const current = await pairNamed("Robera Desktop")
    const other = await pairNamed("Office Laptop")
    const bound = await sessionToken(ownerId, current.device.id)
    const app = await buildApp()
    try {
      const revoked = await app.inject({
        method: "POST",
        url: `/api/settings/devices/${current.device.id}/revoke`,
        cookies: { arciin_session: bound },
      })
      expect(revoked.statusCode).toBe(200)

      const after = await prisma.device.findMany({
        where: { id: { in: [current.device.id, other.device.id] } },
        select: { id: true, status: true },
      })
      expect(after.find((device) => device.id === current.device.id)?.status).toBe("REVOKED")
      expect(after.find((device) => device.id === other.device.id)?.status).toBe("ACTIVE")
    } finally {
      await app.close()
    }
  })
})
