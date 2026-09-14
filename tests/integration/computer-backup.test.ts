import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { hashPassword, hashToken } from "../../apps/api/src/services/security/auth"
import {
  claimDevicePairing,
  createDevicePairing,
  revokeDevice,
} from "../../apps/api/src/services/devices/pairing"
import { enableBackupProfile, hashBackupCredential } from "../../apps/api/src/services/backup/profile"
import { upsertFolderEntry } from "../../apps/api/src/services/backup/sync"
import { buildVisibleAssetWhere } from "../../apps/api/src/services/libraries/visible-asset-query"
import { resolveSmartLibraryScope } from "../../apps/api/src/services/libraries/library-view"
import {
  createAsset,
  createTestStorageRoot,
  prisma,
  removeTestStorageRoot,
  resetDatabase,
  seedBaseFixtures,
  type Fixtures,
} from "./setup"

let fixtures: Fixtures
let ownerId: string
let memberId: string

function stubRedis() {
  return {
    incr: async () => 1,
    expire: async () => 1,
    get: async () => null,
    del: async () => 1,
  }
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

async function pairDevice(name = "Robera Desktop") {
  const { code } = await createDevicePairing(prisma, ownerId)
  return claimDevicePairing(prisma, {
    code,
    name,
    platform: "windows",
    deviceType: "desktop",
    protocolVersion: 1,
  })
}

async function buildApp() {
  const Fastify = (await import("fastify")).default
  const { registerCookies } = await import("../../apps/api/src/plugins/cookies")
  const { registerBackupRoutes } = await import("../../apps/api/src/modules/backup/routes")
  const { registerDiscoveryRoutes, registerDeviceDiscoverAlias } = await import(
    "../../apps/api/src/modules/devices/routes"
  )
  const { registerDeviceSettingsRoutes } = await import(
    "../../apps/api/src/modules/devices/settings-routes"
  )
  const app = Fastify({ logger: false })
  app.decorate("prisma", prisma)
  app.decorate("redis", stubRedis())
  app.decorate("publishRealtimeEvent", async () => {})
  await registerCookies(app)
  await registerDiscoveryRoutes(app)
  await app.register(async (api) => {
    await registerDeviceDiscoverAlias(api)
    await registerDeviceSettingsRoutes(api)
    await registerBackupRoutes(api)
  }, { prefix: "/api" })
  await app.ready()
  return app
}

beforeAll(async () => {
  const root = await createTestStorageRoot()
  await resetDatabase()
  fixtures = await seedBaseFixtures(root)
  ownerId = fixtures.user.id
  await prisma.user.update({
    where: { id: ownerId },
    data: { passwordHash: await hashPassword("TestPass123!") },
  })
  memberId = (
    await prisma.user.create({
      data: {
        name: "Member",
        email: "backup-member@test.invalid",
        passwordHash: await hashPassword("TestPass123!"),
        role: "MEMBER",
        status: "ACTIVE",
      },
    })
  ).id
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
})

afterAll(async () => {
  await resetDatabase()
  await prisma.instanceConfig.deleteMany()
  await removeTestStorageRoot()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await prisma.syncEntry.deleteMany()
  await prisma.syncRoot.deleteMany()
  await prisma.deviceBackupGrant.deleteMany()
  await prisma.deviceBackupProfile.deleteMany()
  await prisma.deviceSession.deleteMany()
  await prisma.devicePairing.deleteMany()
  await prisma.session.deleteMany()
  await prisma.device.deleteMany()
})

describe("computer backup authorization", () => {
  it("rejects unauthenticated enable", async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/backup/profiles",
        payload: { deviceId: "x" },
      })
      expect(res.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })

  it("rejects unpaired devices", async () => {
    const app = await buildApp()
    try {
      const token = await sessionToken(ownerId)
      const res = await app.inject({
        method: "POST",
        url: "/api/backup/profiles",
        cookies: { arciin_session: token },
        payload: { deviceId: "missing" },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("BACKUP_DEVICE_UNPAIRED")
    } finally {
      await app.close()
    }
  })

  it("issues a sync credential once and stores only the hash", async () => {
    const paired = await pairDevice()
    const app = await buildApp()
    try {
      const token = await sessionToken(ownerId)
      const res = await app.inject({
        method: "POST",
        url: "/api/backup/profiles",
        cookies: { arciin_session: token },
        payload: {
          deviceId: paired.device.id,
          roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-root" }],
        },
      })
      expect(res.statusCode).toBe(201)
      const body = res.json().data
      expect(body.credential).toMatch(/^arcsync_/)
      expect(body.credentialIssued).toBe(true)
      const grants = await prisma.deviceBackupGrant.findMany({ where: { deviceId: paired.device.id } })
      expect(grants).toHaveLength(1)
      expect(grants[0]!.credentialHash).toBe(hashBackupCredential(body.credential))
      expect(JSON.stringify(grants[0])).not.toContain(body.credential)

      const again = await app.inject({
        method: "POST",
        url: "/api/backup/profiles",
        cookies: { arciin_session: token },
        payload: { deviceId: paired.device.id },
      })
      expect(again.json().data.credential).toBeNull()
    } finally {
      await app.close()
    }
  })

  it("does not let a pairing credential use backup APIs", async () => {
    const paired = await pairDevice()
    await enableBackupProfile(prisma, { userId: ownerId, deviceId: paired.device.id })
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/backup/me",
        headers: { authorization: `Device ${paired.credential}` },
      })
      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe("BACKUP_CREDENTIAL_INVALID")
    } finally {
      await app.close()
    }
  })

  it("denies cross-user access and invalidates grants on revoke or disable", async () => {
    const paired = await pairDevice()
    const enabled = await enableBackupProfile(prisma, {
      userId: ownerId,
      deviceId: paired.device.id,
      roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-root" }],
    })
    const app = await buildApp()
    try {
      const memberToken = await sessionToken(memberId)
      const forbidden = await app.inject({
        method: "GET",
        url: `/api/backup/profiles/${enabled.profile.id}`,
        cookies: { arciin_session: memberToken },
      })
      expect(forbidden.statusCode).toBe(403)

      const ok = await app.inject({
        method: "GET",
        url: "/api/backup/me",
        headers: { authorization: `ArciinSync ${enabled.credential}` },
      })
      expect(ok.statusCode).toBe(200)

      await revokeDevice(prisma, paired.device.id)
      const revoked = await app.inject({
        method: "GET",
        url: "/api/backup/me",
        headers: { authorization: `ArciinSync ${enabled.credential}` },
      })
      expect(revoked.statusCode).toBeGreaterThanOrEqual(401)
    } finally {
      await app.close()
    }
  })

  it("disable backup keeps the device paired", async () => {
    const paired = await pairDevice()
    const enabled = await enableBackupProfile(prisma, { userId: ownerId, deviceId: paired.device.id })
    const app = await buildApp()
    try {
      const token = await sessionToken(ownerId, paired.device.id)
      const res = await app.inject({
        method: "POST",
        url: `/api/backup/profiles/${enabled.profile.id}/disable`,
        cookies: { arciin_session: token },
      })
      expect(res.statusCode).toBe(200)
      const device = await prisma.device.findUnique({ where: { id: paired.device.id } })
      expect(device?.status).toBe("ACTIVE")
      const listed = await app.inject({
        method: "GET",
        url: "/api/settings/devices",
        cookies: { arciin_session: token },
      })
      expect(listed.statusCode).toBe(200)
      const snapshot = listed.json().data as {
        currentDeviceId: string | null
        devices: Array<{ id: string; status: string; backup: { enabled: boolean } | null }>
      }
      expect(snapshot.currentDeviceId).toBe(paired.device.id)
      expect(snapshot.devices).toHaveLength(1)
      expect(snapshot.devices[0]?.backup?.enabled).toBe(false)
      const denied = await app.inject({
        method: "GET",
        url: "/api/backup/me",
        headers: { authorization: `ArciinSync ${enabled.credential}` },
      })
      expect([401, 403]).toContain(denied.statusCode)
    } finally {
      await app.close()
    }
  })
})

describe("computer backup hierarchy and smart views", () => {
  it("keeps the WebProject tree intact and surfaces files in libraries", async () => {
    const paired = await pairDevice()
    const enabled = await enableBackupProfile(prisma, {
      userId: ownerId,
      deviceId: paired.device.id,
      roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-root" }],
    })
    const root = enabled.profile.roots[0]!

    await upsertFolderEntry(prisma, {
      root,
      clientEntryId: "folder-webproject",
      relativePath: "WebProject",
    })
    await upsertFolderEntry(prisma, {
      root,
      clientEntryId: "folder-public",
      relativePath: "WebProject/public",
    })

    const photo = await createAsset(fixtures, {
      librarySlug: "computers",
      mediaType: "IMAGE",
      originalFilename: "photo.jpg",
      extension: "jpg",
      mimeType: "image/jpeg",
    })
    const invoice = await createAsset(fixtures, {
      librarySlug: "computers",
      mediaType: "DOCUMENT",
      originalFilename: "invoice.pdf",
      extension: "pdf",
      mimeType: "application/pdf",
    })
    const video = await createAsset(fixtures, {
      librarySlug: "computers",
      mediaType: "VIDEO",
      originalFilename: "video.mp4",
      extension: "mp4",
      mimeType: "video/mp4",
    })
    const logo = await createAsset(fixtures, {
      librarySlug: "computers",
      mediaType: "IMAGE",
      originalFilename: "logo.png",
      extension: "png",
      mimeType: "image/png",
    })
    const demo = await createAsset(fixtures, {
      librarySlug: "computers",
      mediaType: "VIDEO",
      originalFilename: "demo.mp4",
      extension: "mp4",
      mimeType: "video/mp4",
    })
    const pkg = await createAsset(fixtures, {
      librarySlug: "computers",
      mediaType: "CODE",
      originalFilename: "package.json",
      extension: "json",
      mimeType: "application/json",
    })

    const desktopFolder = await prisma.folder.findUniqueOrThrow({ where: { id: root.folderId } })
    const webProject = await prisma.folder.findFirstOrThrow({
      where: { parentFolderId: desktopFolder.id, name: "WebProject" },
    })
    const publicFolder = await prisma.folder.findFirstOrThrow({
      where: { parentFolderId: webProject.id, name: "public" },
    })

    await prisma.asset.update({ where: { id: photo.id }, data: { folderId: desktopFolder.id } })
    await prisma.asset.update({ where: { id: invoice.id }, data: { folderId: desktopFolder.id } })
    await prisma.asset.update({ where: { id: video.id }, data: { folderId: desktopFolder.id } })
    await prisma.asset.update({ where: { id: pkg.id }, data: { folderId: webProject.id } })
    const placedLogo = await prisma.asset.update({
      where: { id: logo.id },
      data: { folderId: publicFolder.id },
    })
    const placedDemo = await prisma.asset.update({
      where: { id: demo.id },
      data: { folderId: webProject.id },
    })

    await prisma.syncEntry.createMany({
      data: [
        { syncRootId: root.id, clientEntryId: "photo", relativePath: "photo.jpg", entryType: "FILE", assetId: photo.id },
        { syncRootId: root.id, clientEntryId: "invoice", relativePath: "invoice.pdf", entryType: "FILE", assetId: invoice.id },
        { syncRootId: root.id, clientEntryId: "video", relativePath: "video.mp4", entryType: "FILE", assetId: video.id },
        { syncRootId: root.id, clientEntryId: "pkg", relativePath: "WebProject/package.json", entryType: "FILE", assetId: pkg.id },
        { syncRootId: root.id, clientEntryId: "logo", relativePath: "WebProject/public/logo.png", entryType: "FILE", assetId: logo.id },
        { syncRootId: root.id, clientEntryId: "demo", relativePath: "WebProject/demo.mp4", entryType: "FILE", assetId: demo.id },
      ],
    })

    const imagesScope = await resolveSmartLibraryScope(prisma, { libraryId: fixtures.libraries.images.id })
    const videosScope = await resolveSmartLibraryScope(prisma, { libraryId: fixtures.libraries.videos.id })
    const documentsScope = await resolveSmartLibraryScope(prisma, { libraryId: fixtures.libraries.documents.id })

    const images = await prisma.asset.findMany({ where: buildVisibleAssetWhere({ scope: imagesScope }) })
    const videos = await prisma.asset.findMany({ where: buildVisibleAssetWhere({ scope: videosScope }) })
    const documents = await prisma.asset.findMany({ where: buildVisibleAssetWhere({ scope: documentsScope }) })

    expect(images.map((a) => a.originalFilename).sort()).toEqual(["logo.png", "photo.jpg"])
    expect(videos.map((a) => a.originalFilename).sort()).toEqual(["demo.mp4", "video.mp4"])
    expect(documents.map((a) => a.originalFilename)).toEqual(["invoice.pdf"])

    expect(placedLogo.libraryId).toBe(fixtures.libraries.computers.id)
    expect(placedDemo.libraryId).toBe(fixtures.libraries.computers.id)
    expect(placedLogo.folderId).toBe(publicFolder.id)
    expect(placedDemo.folderId).toBe(webProject.id)

    const inbox = await prisma.asset.findMany({
      where: buildVisibleAssetWhere({ scope: { kind: "library", libraryId: fixtures.libraries.inbox.id } }),
    })
    expect(inbox.map((a) => a.id)).not.toContain(photo.id)
  })

  it("rejects path traversal on folder create", async () => {
    const paired = await pairDevice()
    const enabled = await enableBackupProfile(prisma, {
      userId: ownerId,
      deviceId: paired.device.id,
      roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-root" }],
    })
    await expect(
      upsertFolderEntry(prisma, {
        root: enabled.profile.roots[0]!,
        clientEntryId: "evil",
        relativePath: "../secret",
      }),
    ).rejects.toMatchObject({ code: "PATH_TRAVERSAL" })
  })

  it("rejects overlong relative paths", async () => {
    const paired = await pairDevice()
    const enabled = await enableBackupProfile(prisma, {
      userId: ownerId,
      deviceId: paired.device.id,
      roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-root" }],
    })
    await expect(
      upsertFolderEntry(prisma, {
        root: enabled.profile.roots[0]!,
        clientEntryId: "too-long",
        relativePath: `${"a".repeat(2000)}/file`,
      }),
    ).rejects.toMatchObject({ code: "PATH_TOO_LONG" })
  })

  it("is idempotent for the same folder operationId", async () => {
    const paired = await pairDevice()
    const enabled = await enableBackupProfile(prisma, {
      userId: ownerId,
      deviceId: paired.device.id,
      roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-root" }],
    })
    const app = await buildApp()
    try {
      const payload = {
        syncRootId: enabled.profile.roots[0]!.id,
        clientEntryId: "folder-once",
        relativePath: "WebProject",
        operationId: "op-folder-1",
      }
      const first = await app.inject({
        method: "POST",
        url: "/api/backup/folders",
        headers: { authorization: `ArciinSync ${enabled.credential}` },
        payload,
      })
      const second = await app.inject({
        method: "POST",
        url: "/api/backup/folders",
        headers: { authorization: `ArciinSync ${enabled.credential}` },
        payload,
      })
      expect(first.statusCode).toBe(200)
      expect(second.statusCode).toBe(200)
      expect(second.json().data.id).toBe(first.json().data.id)
      const count = await prisma.syncEntry.count({
        where: { syncRootId: enabled.profile.roots[0]!.id, clientEntryId: "folder-once" },
      })
      expect(count).toBe(1)
    } finally {
      await app.close()
    }
  })

  it("rejects a grant from one device using another device root", async () => {
    const first = await pairDevice("Robera Desktop")
    const second = await pairDevice("Office Laptop")
    const enabledA = await enableBackupProfile(prisma, {
      userId: ownerId,
      deviceId: first.device.id,
      roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-a" }],
    })
    const enabledB = await enableBackupProfile(prisma, {
      userId: ownerId,
      deviceId: second.device.id,
      roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-b" }],
    })
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/backup/folders",
        headers: { authorization: `ArciinSync ${enabledA.credential}` },
        payload: {
          syncRootId: enabledB.profile.roots[0]!.id,
          clientEntryId: "cross",
          relativePath: "stolen",
        },
      })
      expect(res.statusCode).toBe(404)
    } finally {
      await app.close()
    }
  })
})

describe("sync root lifecycle", () => {
  async function enableTwoRoots() {
    const paired = await pairDevice()
    const enabled = await enableBackupProfile(prisma, {
      userId: ownerId,
      deviceId: paired.device.id,
      roots: [
        { kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-root" },
        { kind: "CUSTOM", displayName: "TestBackup", sourcePathIdentifier: "test-backup" },
      ],
    })
    return { paired, enabled }
  }

  it("owner can disable one root; writes are rejected; other roots still sync; files remain", async () => {
    const { paired, enabled } = await enableTwoRoots()
    const desktop = enabled.profile.roots.find((root) => root.sourcePathIdentifier === "desktop-root")!
    const testBackup = enabled.profile.roots.find((root) => root.sourcePathIdentifier === "test-backup")!
    const photo = await createAsset(fixtures, {
      librarySlug: "computers",
      mediaType: "IMAGE",
      originalFilename: "kept.jpg",
      extension: "jpg",
      mimeType: "image/jpeg",
    })
    await prisma.asset.update({ where: { id: photo.id }, data: { folderId: testBackup.folderId } })
    await prisma.syncEntry.create({
      data: {
        syncRootId: testBackup.id,
        clientEntryId: "kept",
        relativePath: "kept.jpg",
        entryType: "FILE",
        assetId: photo.id,
      },
    })

    const app = await buildApp()
    try {
      const token = await sessionToken(ownerId)
      const disable = await app.inject({
        method: "POST",
        url: `/api/backup/roots/${testBackup.id}/disable`,
        cookies: { arciin_session: token },
      })
      expect(disable.statusCode).toBe(200)
      expect(disable.json().data.status).toBe("DISABLED")

      const memberToken = await sessionToken(memberId)
      const forbidden = await app.inject({
        method: "POST",
        url: `/api/backup/roots/${desktop.id}/disable`,
        cookies: { arciin_session: memberToken },
      })
      expect(forbidden.statusCode).toBe(403)

      const rejected = await app.inject({
        method: "POST",
        url: "/api/backup/folders",
        headers: { authorization: `ArciinSync ${enabled.credential}` },
        payload: {
          syncRootId: testBackup.id,
          clientEntryId: "after-disable",
          relativePath: "new-folder",
        },
      })
      expect(rejected.statusCode).toBe(403)
      expect(rejected.json().error.code).toBe("SYNC_ROOT_DISABLED")

      const stillOk = await app.inject({
        method: "POST",
        url: "/api/backup/folders",
        headers: { authorization: `ArciinSync ${enabled.credential}` },
        payload: {
          syncRootId: desktop.id,
          clientEntryId: "desktop-still",
          relativePath: "StillActive",
        },
      })
      expect(stillOk.statusCode).toBe(200)

      const devices = await app.inject({
        method: "GET",
        url: "/api/settings/devices",
        cookies: { arciin_session: token },
      })
      expect(devices.json().data.devices[0].backup.rootCount).toBe(1)
      expect(devices.json().data.devices[0].backup.enabled).toBe(true)

      const browse = await app.inject({
        method: "GET",
        url: `/api/computers/${paired.device.id}/browse?folderId=${testBackup.folderId}`,
        cookies: { arciin_session: token },
      })
      expect(browse.statusCode).toBe(200)
      expect(browse.json().data.assets.some((asset: { originalFilename: string }) => asset.originalFilename === "kept.jpg")).toBe(true)
      expect(browse.json().data.assets[0].sourceContext.rootDisplayName).toBe("TestBackup")
      expect(browse.json().data.assets[0].sourceContext.rootStatus).toBe("DISABLED")

      const stored = await prisma.asset.findUnique({ where: { id: photo.id } })
      expect(stored?.deletedAt).toBeNull()
      expect(await prisma.device.count({ where: { id: paired.device.id, status: "ACTIVE" } })).toBe(1)

      const reenable = await app.inject({
        method: "POST",
        url: `/api/backup/roots/${testBackup.id}/enable`,
        cookies: { arciin_session: token },
      })
      expect(reenable.statusCode).toBe(200)
      expect(reenable.json().data.id).toBe(testBackup.id)
      expect(reenable.json().data.folderId).toBe(testBackup.folderId)
      expect(reenable.json().data.status).toBe("PROTECTED")
      expect(await prisma.syncRoot.count({ where: { profileId: enabled.profile.id } })).toBe(2)

      const sameId = await app.inject({
        method: "POST",
        url: "/api/backup/roots",
        headers: { authorization: `ArciinSync ${enabled.credential}` },
        payload: {
          kind: "CUSTOM",
          displayName: "TestBackup",
          sourcePathIdentifier: "test-backup",
        },
      })
      expect(sameId.statusCode).toBe(201)
      expect(sameId.json().data.id).toBe(testBackup.id)
      expect(await prisma.syncEntry.count({ where: { syncRootId: testBackup.id, clientEntryId: "kept" } })).toBe(1)
    } finally {
      await app.close()
    }
  })

  it("another device grant cannot disable this root", async () => {
    const first = await pairDevice("Robera Desktop")
    const second = await pairDevice("Office Laptop")
    const enabledA = await enableBackupProfile(prisma, {
      userId: ownerId,
      deviceId: first.device.id,
      roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-a" }],
    })
    const enabledB = await enableBackupProfile(prisma, {
      userId: ownerId,
      deviceId: second.device.id,
      roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-b" }],
    })
    const app = await buildApp()
    try {
      const res = await app.inject({
        method: "POST",
        url: `/api/backup/roots/${enabledA.profile.roots[0]!.id}/disable`,
        headers: { authorization: `ArciinSync ${enabledB.credential}` },
      })
      expect(res.statusCode).toBe(403)
      const still = await prisma.syncRoot.findUnique({ where: { id: enabledA.profile.roots[0]!.id } })
      expect(still?.status).not.toBe("DISABLED")
    } finally {
      await app.close()
    }
  })
})

describe("backup profile re-enable and grant rotation", () => {
  it("disable then re-enable reuses the profile and rotates the grant", async () => {
    const paired = await pairDevice()
    const enabled = await enableBackupProfile(prisma, {
      userId: ownerId,
      deviceId: paired.device.id,
      roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-root" }],
    })
    const credentialA = enabled.credential!
    const app = await buildApp()
    try {
      const token = await sessionToken(ownerId, paired.device.id)
      const alive = await app.inject({
        method: "GET",
        url: "/api/backup/me",
        headers: { authorization: `ArciinSync ${credentialA}` },
      })
      expect(alive.statusCode).toBe(200)

      const stop = await app.inject({
        method: "POST",
        url: `/api/backup/profiles/${enabled.profile.id}/disable`,
        cookies: { arciin_session: token },
      })
      expect(stop.statusCode).toBe(200)

      const device = await prisma.device.findUnique({ where: { id: paired.device.id } })
      expect(device?.status).toBe("ACTIVE")
      const session = await prisma.session.findFirst({ where: { userId: ownerId } })
      expect(session).toBeTruthy()
      expect(await prisma.deviceBackupProfile.count({ where: { deviceId: paired.device.id } })).toBe(1)
      const roots = await prisma.syncRoot.findMany({ where: { profileId: enabled.profile.id } })
      expect(roots.every((root) => root.status === "DISABLED")).toBe(true)

      const deadAfterStop = await app.inject({
        method: "GET",
        url: "/api/backup/me",
        headers: { authorization: `ArciinSync ${credentialA}` },
      })
      expect([401, 403]).toContain(deadAfterStop.statusCode)

      const rotateWhileDisabled = await app.inject({
        method: "POST",
        url: `/api/backup/profiles/${enabled.profile.id}/rotate`,
        cookies: { arciin_session: token },
      })
      expect(rotateWhileDisabled.statusCode).toBe(403)
      expect(rotateWhileDisabled.json().error.code).toBe("BACKUP_DISABLED")

      const again = await app.inject({
        method: "POST",
        url: `/api/backup/profiles/${enabled.profile.id}/enable`,
        cookies: { arciin_session: token },
        payload: {
          roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-root" }],
        },
      })
      expect(again.statusCode).toBe(201)
      const body = again.json().data
      expect(body.profile.id).toBe(enabled.profile.id)
      expect(body.credential).toMatch(/^arcsync_/)
      expect(body.credential).not.toBe(credentialA)
      expect(body.credentialIssued).toBe(true)
      const grants = await prisma.deviceBackupGrant.findMany({ where: { profileId: enabled.profile.id } })
      expect(grants.some((grant) => grant.credentialHash === hashBackupCredential(body.credential))).toBe(true)
      expect(JSON.stringify(grants)).not.toContain(body.credential)
      expect(JSON.stringify(grants)).not.toContain(credentialA)
      expect(await prisma.deviceBackupProfile.count({ where: { deviceId: paired.device.id } })).toBe(1)
      expect(await prisma.device.count({ where: { id: paired.device.id } })).toBe(1)

      const stillDead = await app.inject({
        method: "GET",
        url: "/api/backup/me",
        headers: { authorization: `ArciinSync ${credentialA}` },
      })
      expect([401, 403]).toContain(stillDead.statusCode)

      const credentialB = await app.inject({
        method: "GET",
        url: "/api/backup/me",
        headers: { authorization: `ArciinSync ${body.credential}` },
      })
      expect(credentialB.statusCode).toBe(200)
      expect(credentialB.json().data.id).toBe(enabled.profile.id)
      expect(credentialB.json().data.roots[0].status).toBe("PROTECTED")
    } finally {
      await app.close()
    }
  })

  it("bound Desktop session cannot re-enable another computer's profile", async () => {
    const first = await pairDevice("Robera Desktop")
    const second = await pairDevice("Office Laptop")
    const enabledB = await enableBackupProfile(prisma, { userId: ownerId, deviceId: second.device.id })
    const app = await buildApp()
    try {
      const token = await sessionToken(ownerId, first.device.id)
      await app.inject({
        method: "POST",
        url: `/api/backup/profiles/${enabledB.profile.id}/disable`,
        cookies: { arciin_session: token },
      })
      const res = await app.inject({
        method: "POST",
        url: `/api/backup/profiles/${enabledB.profile.id}/enable`,
        cookies: { arciin_session: token },
      })
      expect(res.statusCode).toBe(403)
      expect(res.json().error.code).toBe("BACKUP_FORBIDDEN")
    } finally {
      await app.close()
    }
  })
})

describe("discovery capability", () => {
  it("advertises computer backup without changing pairing protocol 1", async () => {
    const app = await buildApp()
    try {
      const res = await app.inject({ method: "GET", url: "/.well-known/arciin" })
      const body = res.json()
      expect(body.protocolVersion).toBe(1)
      expect(body.capabilities.computerBackup.supported).toBe(true)
      expect(body.capabilities.computerBackup.protocolVersion).toBe(1)
    } finally {
      await app.close()
    }
  })
})
