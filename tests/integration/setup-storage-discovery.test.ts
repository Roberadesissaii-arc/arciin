import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { apiConfig } from "../../apps/api/src/config"
import { hashToken } from "../../apps/api/src/services/security/auth"
import { SETUP_TOKEN_HEADER } from "../../apps/api/src/services/security/setup-authorization"
import { logContainsSecret, serializeRequestForLog } from "../../apps/api/src/services/security/request-log-redaction"
import {
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
} from "./setup"

const VALID_TOKEN = apiConfig.setupToken

function stubRedis() {
  return {
    incr: async () => 1,
    expire: async () => 1,
  }
}

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerInstanceRoutes } = await import("../../apps/api/src/modules/instance/routes")
  const { registerSettingsRoutes } = await import("../../apps/api/src/modules/settings/routes")
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const app = Fastify({ logger: false })
  app.decorate("prisma", prisma)
  app.decorate("redis", stubRedis())
  await registerCookies(app)
  await registerInstanceRoutes(app)
  await registerSettingsRoutes(app)
  await app.ready()
  return app
}

describe("pre-claim storage discovery (ARC-008)", () => {
  beforeAll(async () => {
    await createTestStorageRoot()
  })

  afterAll(async () => {
    await resetDatabase()
    await prisma.instanceConfig.deleteMany()
    await removeTestStorageRoot()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await resetDatabase()
    await prisma.instanceConfig.deleteMany()
  })

  it("rejects a visitor with no setup token", async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({ method: "GET", url: "/instance/storage-discovery" })
      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe("SETUP_TOKEN_REQUIRED")
      expect(res.json()).not.toHaveProperty("data.volumes")
    } finally {
      await app.close()
    }
  })

  it("rejects a wrong setup token", async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "GET",
        url: "/instance/storage-discovery",
        headers: { [SETUP_TOKEN_HEADER]: "not-the-token" },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("INVALID_SETUP_TOKEN")
    } finally {
      await app.close()
    }
  })

  it("ignores a token placed in the URL", async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "GET",
        url: `/instance/storage-discovery?token=${VALID_TOKEN}&setupToken=${VALID_TOKEN}`,
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it("returns minimized discovery with a valid setup token", async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "GET",
        url: "/instance/storage-discovery",
        headers: { [SETUP_TOKEN_HEADER]: VALID_TOKEN },
      })
      expect(res.statusCode).toBe(200)
      const data = res.json().data as Record<string, unknown>
      expect(data).toHaveProperty("recommendedArciinPath")
      expect(data).toHaveProperty("volumes")
      expect(data).toHaveProperty("unmountedDevices")
      expect(data).not.toHaveProperty("blockDisks")
      expect(data).not.toHaveProperty("currentDeviceContext")
      expect(data).not.toHaveProperty("installNotes")
      expect(data).not.toHaveProperty("runtimeDataDir")
      expect(data).not.toHaveProperty("hostDataDir")
      expect(data).not.toHaveProperty("osRoot")
      expect(JSON.stringify(data)).not.toContain(VALID_TOKEN)
    } finally {
      await app.close()
    }
  })

  it("rejects prepare without setup authorization", async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "POST",
        url: "/instance/storage-prepare",
        payload: { path: "/tmp/arciin-should-not-prepare" },
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it("does not let a setup token bypass post-claim auth", async () => {
    const root = "/tmp/arciin-integration-storage"
    await seedBaseFixtures(root)
    const app = await buildApp()
    try {
      const discovery = await app.inject({
        method: "GET",
        url: "/instance/storage-discovery",
        headers: { [SETUP_TOKEN_HEADER]: VALID_TOKEN },
      })
      expect(discovery.statusCode).toBe(409)
      expect(discovery.json().error.code).toBe("INSTANCE_ALREADY_INITIALIZED")

      const mount = await app.inject({
        method: "POST",
        url: "/settings/storage/mount",
        headers: { [SETUP_TOKEN_HEADER]: VALID_TOKEN },
        payload: { deviceId: "unmounted-sda1" },
      })
      expect(mount.statusCode).toBe(401)

      const owner = await prisma.user.findFirst({ where: { role: "OWNER" } })
      expect(owner).not.toBeNull()
      const raw = `sess_${owner!.id}_${Date.now()}`
      await prisma.session.create({
        data: {
          userId: owner!.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      })
      const authedMount = await app.inject({
        method: "POST",
        url: "/settings/storage/mount",
        headers: { authorization: `Bearer ${raw}` },
        payload: { deviceId: "missing-device" },
      })
      expect(authedMount.statusCode).not.toBe(401)
      expect([400, 404, 500]).toContain(authedMount.statusCode)
    } finally {
      await app.close()
    }
  })

  it("never writes the setup token into the request serializer", () => {
    const logged = serializeRequestForLog({
      method: "GET",
      url: `/instance/storage-discovery?token=${VALID_TOKEN}`,
      headers: { [SETUP_TOKEN_HEADER]: VALID_TOKEN },
    })
    expect(logContainsSecret(logged, VALID_TOKEN)).toBe(false)
  })
})
