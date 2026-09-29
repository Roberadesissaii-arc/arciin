import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { hashToken } from "../../apps/api/src/services/security/auth"
import {
  createAsset,
  createFolder,
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

/**
 * Database → Folders, told truthfully.
 *
 * Computer Backup is gone, but its folder trees were kept on purpose; on the
 * production instance they are thousands of rows no library shows. The audit
 * classifies from Library.kind (never from names), and it only reads: these
 * tests also pin that nothing is moved or deleted and that no route can.
 */

let fixtures: Fixtures
let ownerCookie: string
let memberCookie: string
let app: Awaited<ReturnType<typeof buildApp>>
const f: Record<string, string> = {}
let before: { folders: number; assets: number; objects: number }

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerAdminRoutes } = await import("../../apps/api/src/modules/admin/routes")
  const a = Fastify({ logger: false })
  a.decorate("prisma", prisma)
  a.decorate("redis", { incr: async () => 1, expire: async () => 1, get: async () => null, del: async () => 1 })
  await registerCookies(a)
  await a.register(async (api) => registerAdminRoutes(api), { prefix: "/api" })
  await a.ready()
  return a
}

async function cookieFor(userId: string) {
  const raw = `sess_${crypto.randomUUID()}`
  await prisma.session.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 86_400_000) } })
  return `arciin_session=${raw}`
}

async function counts() {
  return {
    folders: await prisma.folder.count(),
    assets: await prisma.asset.count(),
    objects: await prisma.storageObject.count(),
  }
}

beforeAll(async () => {
  await resetDatabase()
  fixtures = await seedBaseFixtures(await createTestStorageRoot())
  const member = await prisma.user.create({ data: { email: "folders-member@example.invalid", name: "M", passwordHash: "x", role: "MEMBER", status: "ACTIVE" } })
  ownerCookie = await cookieFor(fixtures.user.id)
  memberCookie = await cookieFor(member.id)

  // Current: a folder, a nested folder with a file, a deleted folder.
  f.current = (await createFolder(fixtures, { librarySlug: "images", name: "Holidays" })).id
  f.nested = (await createFolder(fixtures, { librarySlug: "images", name: "Spain", parentFolderId: f.current })).id
  await createAsset(fixtures, { librarySlug: "images", folderId: f.nested, mediaType: "IMAGE" })
  f.currentDeleted = (await createFolder(fixtures, { librarySlug: "images", name: "Old stuff", deletedAt: new Date() })).id

  // Legacy Computer Backup: a device root, a folder with a file, an empty
  // __pycache__, and a deleted legacy folder.
  f.device = (await createFolder(fixtures, { librarySlug: "computers", name: "device-abc" })).id
  f.desktop = (await createFolder(fixtures, { librarySlug: "computers", name: "desktop", parentFolderId: f.device })).id
  f.pycache = (await createFolder(fixtures, { librarySlug: "computers", name: "__pycache__", parentFolderId: f.desktop })).id
  await createAsset(fixtures, { librarySlug: "computers", folderId: f.desktop, mediaType: "DOCUMENT" })
  await createAsset(fixtures, { librarySlug: "computers", folderId: f.desktop, mediaType: "DOCUMENT", deletedAt: new Date() })
  f.legacyDeleted = (await createFolder(fixtures, { librarySlug: "computers", name: "gone", parentFolderId: f.device, deletedAt: new Date() })).id
  // A path with LIKE wildcards in it must not swallow a sibling root.
  f.otherRoot = (await createFolder(fixtures, { librarySlug: "computers", name: "device_ab" })).id

  before = await counts()
  app = await buildApp()
})

afterAll(async () => {
  await app?.close()
  await resetDatabase()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

describe("folder audit", () => {
  it("classifies by library kind and counts what is really there", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/folders/audit", headers: { cookie: ownerCookie } })
    expect(res.statusCode).toBe(200)
    const a = res.json().data
    expect(a).toMatchObject({
      total: 8,
      live: 6,
      deleted: 2,
      current: 2,
      legacyComputer: 4,
      legacyWithAssets: 1,
      legacyWithoutAssets: 3,
      legacyDeleted: 1,
      legacyAssets: 1,
      legacyAssetsInTrash: 1,
      currentWithAssets: 1,
      assetsInCurrentFolders: 1,
      maxDepth: { current: 2, legacy: 3 },
    })
    expect(a.legacyRoots.count).toBe(2)
    expect(a.legacyRoots.largest[0]).toEqual({ name: "device-abc", folders: 3, assets: 1 })
    expect(a.legacyRoots.largest[1]).toEqual({ name: "device_ab", folders: 1, assets: 0 })
    expect(a.perLibrary.find((l: { kind: string }) => l.kind === "COMPUTER")).toMatchObject({ legacy: 4, deleted: 1, current: 0 })
    expect(a.perLibrary.find((l: { kind: string }) => l.kind === "IMAGE")).toMatchObject({ current: 2, deleted: 1, legacy: 0 })
    expect(a.diagnostics.devTreeFolderNames).toEqual([{ name: "__pycache__", folders: 1 }])
    // Counts and names only: no storage path leaks out.
    expect(res.body).not.toContain(fixtures.storageLocation.rootPath)
  })

  it("is owner/admin only", async () => {
    expect((await app.inject({ method: "GET", url: "/api/admin/folders/audit" })).statusCode).toBe(401)
    expect((await app.inject({ method: "GET", url: "/api/admin/folders/audit", headers: { cookie: memberCookie } })).statusCode).toBe(403)
  })

  it("the Database summary says current / legacy / deleted instead of one big number", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/tables", headers: { cookie: ownerCookie } })
    const folders = (res.json().data as Array<{ name: string; summary: Array<{ label: string; value: number }> }>).find((t) => t.name === "folders")!
    expect(folders.summary).toEqual([
      { label: "historical records", value: 8, tone: "neutral" },
      { label: "current", value: 2, tone: "success" },
      { label: "legacy computer", value: 4, tone: "warning" },
      { label: "deleted", value: 2, tone: "danger" },
    ])
  })

  it.each([
    ["all", 8],
    ["current", 2],
    ["legacy", 4],
    ["deleted", 2],
  ])("the folder table filters %s → %i rows, with a classification and library column", async (status, expected) => {
    const res = await app.inject({ method: "GET", url: `/api/admin/tables/folders?limit=50&status=${status}`, headers: { cookie: ownerCookie } })
    expect(res.statusCode).toBe(200)
    const data = res.json().data as { rows: Array<{ classification: string; library: string; libraryKind: string }>; total: number }
    expect(data.total).toBe(expected)
    expect(data.rows).toHaveLength(expected)
    if (status !== "all") expect(new Set(data.rows.map((r) => r.classification))).toEqual(new Set([status]))
    for (const row of data.rows) {
      expect(row.library).toBeTruthy()
      expect(row.libraryKind).toBeTruthy()
    }
  })

  it("pages the legacy filter honestly", async () => {
    const page1 = await app.inject({ method: "GET", url: "/api/admin/tables/folders?limit=2&page=1&status=legacy", headers: { cookie: ownerCookie } })
    const page2 = await app.inject({ method: "GET", url: "/api/admin/tables/folders?limit=3&page=2&status=legacy", headers: { cookie: ownerCookie } })
    expect(page1.json().data).toMatchObject({ total: 4, totalPages: 2 })
    expect(page2.json().data).toMatchObject({ total: 4, totalPages: 2 })
    expect(page2.json().data.rows).toHaveLength(1)
  })

  it("rejects an unknown filter, and keeps the API-key filters as they were", async () => {
    expect((await app.inject({ method: "GET", url: "/api/admin/tables/folders?status=revoked", headers: { cookie: ownerCookie } })).statusCode).toBe(400)
    expect((await app.inject({ method: "GET", url: "/api/admin/tables/api-keys?status=legacy", headers: { cookie: ownerCookie } })).statusCode).toBe(400)
    expect((await app.inject({ method: "GET", url: "/api/admin/tables/api-keys?status=revoked", headers: { cookie: ownerCookie } })).statusCode).toBe(200)
  })

  it("changed nothing: every Folder, Asset and StorageObject is still there", async () => {
    expect(await counts()).toEqual(before)
    const live = await prisma.folder.findMany({ where: { id: { in: Object.values(f) } }, select: { id: true, deletedAt: true, libraryId: true } })
    expect(live).toHaveLength(Object.keys(f).length)
  })

  it("offers no way to delete or rewrite folders from the audit", async () => {
    for (const method of ["DELETE", "POST", "PATCH", "PUT"] as const) {
      const res = await app.inject({ method, url: "/api/admin/folders/audit", headers: { cookie: ownerCookie } })
      expect(res.statusCode, method).toBe(404)
    }
    expect(await counts()).toEqual(before)
  })
})
