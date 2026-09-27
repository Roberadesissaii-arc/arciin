import { chmod, rm } from "node:fs/promises"
import path from "node:path"

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { ensureDefaultMediaIntegrations } from "../../apps/api/src/services/integrations/ensure-default-integrations"
import {
  JELLYFIN_CONNECTOR_DEF,
  PLEX_CONNECTOR_DEF,
  connectMediaConnector,
  disconnectMediaConnector,
  getConnectorStatus,
  type MediaConnectorDef,
} from "../../apps/api/src/services/integrations/library-media-connector"
import { hashToken } from "../../apps/api/src/services/security/auth"
import {
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
} from "./setup"

/**
 * Plex and Jellyfin report one of four states, and only what is true.
 *
 * Both are folder connectors: health is about the folders Arciin keeps and the
 * on-disk mirror a media server scans. Each matrix drives the real service
 * against real Postgres and a real temporary directory tree.
 */

let root: string

beforeAll(async () => {
  root = await createTestStorageRoot()
  await resetDatabase()
  await prisma.integration.deleteMany()
  await seedBaseFixtures(root)
  await prisma.instanceConfig.deleteMany()
  await prisma.instanceConfig.create({
    data: { instanceName: "Health", storageRoot: root, initializedAt: new Date(), licensePlan: "free", licenseStatus: "none" },
  })
  await ensureDefaultMediaIntegrations(prisma)
})

afterAll(async () => {
  await chmod(path.join(root, "libraries"), 0o755).catch(() => {})
  await prisma.integration.deleteMany()
  await prisma.instanceConfig.deleteMany()
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

const matrix: Array<[string, MediaConnectorDef]> = [
  ["Plex", PLEX_CONNECTOR_DEF],
  ["Jellyfin", JELLYFIN_CONNECTOR_DEF],
]

describe.each(matrix)("%s health", (name, def) => {
  beforeEach(async () => {
    await chmod(path.join(root, "libraries"), 0o755).catch(() => {})
    const integration = (await def.findIntegration(prisma))!
    await disconnectMediaConnector(prisma, def, integration)
  })

  async function status() {
    const s = await getConnectorStatus(prisma, def)
    expect(s).not.toBeNull()
    // The reason is shown to people; it must never carry the server's path.
    expect(s!.health.reason).not.toContain(root)
    return s!
  }

  it("disconnected when turned off", async () => {
    const s = await status()
    expect(s.enabled).toBe(false)
    expect(s.health.state).toBe("disconnected")
  })

  it("healthy when on and every folder is present in Arciin and on disk", async () => {
    await connectMediaConnector(prisma, def, (await def.findIntegration(prisma))!)
    const s = await status()
    expect(s.health.state).toBe("healthy")
    expect(s.folders.length).toBe(3)
    expect(s.folders.every((f) => f.ready && f.onDisk)).toBe(true)
  })

  it("degraded, never 'connected', when a folder is gone from a library", async () => {
    await connectMediaConnector(prisma, def, (await def.findIntegration(prisma))!)
    const videos = await prisma.library.findFirstOrThrow({ where: { slug: "videos" } })
    await prisma.folder.deleteMany({ where: { libraryId: videos.id, name: name } })
    const s = await status()
    expect(s.health.state).toBe("degraded")
    expect(s.health.reason).toContain("Videos")
    expect(s.health.reason).toMatch(/Repair folders/)
  })

  it("degraded when the mirror directory is missing on disk", async () => {
    await connectMediaConnector(prisma, def, (await def.findIntegration(prisma))!)
    const music = s3(await status())
    await rm(path.join(root, "libraries", "music", music), { recursive: true, force: true })
    const s = await status()
    expect(s.health.state).toBe("degraded")
    expect(s.folders.find((f) => f.librarySlug === "music")?.onDisk).toBe(false)
    expect(s.health.reason).toContain("on disk")
  })

  it("repairing a degraded connector returns it to healthy", async () => {
    await connectMediaConnector(prisma, def, (await def.findIntegration(prisma))!)
    const images = await prisma.library.findFirstOrThrow({ where: { slug: "images" } })
    await prisma.folder.deleteMany({ where: { libraryId: images.id, name: name } })
    expect((await status()).health.state).toBe("degraded")
    await connectMediaConnector(prisma, def, (await def.findIntegration(prisma))!)
    expect((await status()).health.state).toBe("healthy")
  })

  it.skipIf(process.getuid?.() === 0)("error when the mirror root cannot be written", async () => {
    await connectMediaConnector(prisma, def, (await def.findIntegration(prisma))!)
    await chmod(path.join(root, "libraries"), 0o500)
    try {
      const s = await status()
      expect(s.health.state).toBe("error")
      expect(s.health.reason).toMatch(/mounted and writable/)
    } finally {
      await chmod(path.join(root, "libraries"), 0o755)
    }
  })
})

function s3(s: Awaited<ReturnType<typeof getConnectorStatus>>) {
  const music = s!.folders.find((f) => f.librarySlug === "music")!
  return music.folderPath.slice("music/".length)
}

describe("status route never tells a non-admin where files live", () => {
  it("OWNER sees the mirror path; VIEWER does not", async () => {
    const Fastify = (await import("fastify")).default
    const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
    const { registerIntegrationRoutes } = await import("../../apps/api/src/modules/integrations/routes")
    const app = Fastify({ logger: false })
    app.decorate("prisma", prisma)
    await registerCookies(app)
    await app.register(async (api) => registerIntegrationRoutes(api), { prefix: "/api" })
    await app.ready()

    const cookieFor = async (role: "OWNER" | "VIEWER") => {
      const user = await prisma.user.create({
        data: { email: `health-${role}-${Date.now()}@test.invalid`, name: role, passwordHash: "x", role, status: "ACTIVE" },
      })
      const raw = `sess_${crypto.randomUUID()}`
      await prisma.session.create({
        data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) },
      })
      return `arciin_session=${raw}`
    }
    try {
      for (const base of ["/api/integrations/plex/status", "/api/integrations/jellyfin/status"]) {
        const owner = await app.inject({ method: "GET", url: base, headers: { cookie: await cookieFor("OWNER") } })
        expect(owner.statusCode).toBe(200)
        expect(owner.json().data.mirrorRootHint).toContain(root)
        expect(owner.json().data.health.state).toBeDefined()

        const viewer = await app.inject({ method: "GET", url: base, headers: { cookie: await cookieFor("VIEWER") } })
        expect(viewer.statusCode).toBe(200)
        expect(viewer.body).not.toContain(root)
        expect(viewer.json().data.health.state).toBeDefined()
      }
    } finally {
      await app.close()
    }
  })
})
