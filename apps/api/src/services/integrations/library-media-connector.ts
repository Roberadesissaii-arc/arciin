import { access, copyFile, link, mkdir, unlink } from "node:fs/promises"
import path from "node:path"

import type { Asset, Folder, Integration, Library, PrismaClient, StorageObject } from "@prisma/client"

import { slugify } from "@/services/slug"
import { ensureStorageDirectories, getStoragePaths } from "@/services/storage/local-storage"

export const MEDIA_LIBRARY_SLUGS = ["videos", "images", "music"] as const

export type ConnectorFolderStatus = {
  libraryId: string
  librarySlug: string
  libraryName: string
  folderId: string | null
  folderPath: string
  ready: boolean
}

export type ConnectorStatus = {
  enabled: boolean
  folders: ConnectorFolderStatus[]
  storageRoot: string
  mirrorRootHint: string
}

export type MediaConnectorDef = {
  key: string
  folderName: string
  findIntegration: (prisma: PrismaClient) => Promise<Integration | null>
  enabledActivityType: string
  disabledActivityType: string
  foldersActivityType: string
}

export const JELLYFIN_INTEGRATION_ID = "jellyfin-connector"

export const PLEX_CONNECTOR_DEF: MediaConnectorDef = {
  key: "plex",
  folderName: "Plex",
  findIntegration: (prisma) => prisma.integration.findFirst({ where: { type: "PLEX" } }),
  enabledActivityType: "integration.plex_enabled",
  disabledActivityType: "integration.plex_disabled",
  foldersActivityType: "integration.plex_folders",
}

export const JELLYFIN_CONNECTOR_DEF: MediaConnectorDef = {
  key: "jellyfin",
  folderName: "Jellyfin",
  findIntegration: (prisma) =>
    prisma.integration.findFirst({ where: { id: JELLYFIN_INTEGRATION_ID } }),
  enabledActivityType: "integration.jellyfin_enabled",
  disabledActivityType: "integration.jellyfin_disabled",
  foldersActivityType: "integration.jellyfin_folders",
}

function safeFilename(originalFilename: string): string {
  const base = path.basename(originalFilename).normalize("NFKD")
  const cleaned = base.replace(/[<>:"|?*\x00-\x1f]/g, "-").replace(/\.{2,}/g, ".").trim()
  return cleaned.length > 0 ? cleaned : "file"
}

async function uniqueMirrorPath(dir: string, filename: string): Promise<string> {
  const ext = path.extname(filename)
  const stem = path.basename(filename, ext)
  let candidate = path.join(dir, filename)
  let n = 2
  while (true) {
    try {
      await access(candidate)
      candidate = path.join(dir, `${stem} (${n})${ext}`)
      n += 1
    } catch {
      return candidate
    }
  }
}

export async function findConnectorFolder(
  prisma: PrismaClient,
  libraryId: string,
  folderName: string,
): Promise<Folder | null> {
  return prisma.folder.findFirst({
    where: {
      libraryId,
      deletedAt: null,
      slug: slugify(folderName),
    },
  })
}

export function assetIsInConnectorFolder(
  folder: Folder | null | undefined,
  folderName: string,
): boolean {
  return Boolean(folder && folder.slug === slugify(folderName))
}

export async function isConnectorEnabled(
  prisma: PrismaClient,
  def: MediaConnectorDef,
): Promise<boolean> {
  const row = await def.findIntegration(prisma)
  return Boolean(row?.enabled)
}

export async function ensureConnectorFolders(
  prisma: PrismaClient,
  def: MediaConnectorDef,
): Promise<{ folders: ConnectorFolderStatus[]; created: number }> {
  const libraries = await prisma.library.findMany({
    where: { slug: { in: [...MEDIA_LIBRARY_SLUGS] } },
    orderBy: { slug: "asc" },
  })

  let created = 0
  const folders: ConnectorFolderStatus[] = []
  const folderSlug = slugify(def.folderName)

  for (const library of libraries) {
    let folder = await findConnectorFolder(prisma, library.id, def.folderName)
    if (!folder) {
      folder = await prisma.folder.create({
        data: {
          libraryId: library.id,
          name: def.folderName,
          slug: folderSlug,
          pathCache: folderSlug,
        },
      })
      created += 1
    }

    folders.push({
      libraryId: library.id,
      librarySlug: library.slug,
      libraryName: library.name,
      folderId: folder.id,
      folderPath: `${library.slug}/${folder.pathCache}`,
      ready: true,
    })
  }

  const integration = await def.findIntegration(prisma)
  if (integration) {
    const prev = (integration.config as Record<string, unknown>) ?? {}
    const folderMap: Record<string, string> = {}
    for (const f of folders) {
      if (f.folderId) folderMap[f.librarySlug] = f.folderId
    }
    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        config: {
          ...prev,
          mediaFolders: folderMap,
          foldersReady: folders.every((f) => f.ready),
        },
      },
    })
  }

  return { folders, created }
}

/** Turns off routing/mirroring only—folders and on-disk files are kept. */
export async function disconnectMediaConnector(
  prisma: PrismaClient,
  def: MediaConnectorDef,
  integration: Integration,
) {
  const prev = (integration.config as Record<string, unknown>) ?? {}
  const status = await getConnectorStatus(prisma, def)
  const foldersReady = status?.folders.every((f) => f.ready) ?? false

  return prisma.integration.update({
    where: { id: integration.id },
    data: {
      enabled: false,
      config: {
        ...prev,
        status: "disconnected",
        foldersReady,
      },
    },
  })
}

export async function connectMediaConnector(
  prisma: PrismaClient,
  def: MediaConnectorDef,
  integration: Integration,
) {
  const prev = (integration.config as Record<string, unknown>) ?? {}
  await ensureConnectorFolders(prisma, def)

  return prisma.integration.update({
    where: { id: integration.id },
    data: {
      enabled: true,
      config: {
        ...prev,
        status: "folder_sync",
        foldersReady: true,
      },
    },
  })
}

export async function getConnectorStatus(
  prisma: PrismaClient,
  def: MediaConnectorDef,
): Promise<ConnectorStatus | null> {
  const integration = await def.findIntegration(prisma)
  if (!integration) return null

  const instance = await prisma.instanceConfig.findFirst()
  const storageRoot = instance?.storageRoot ?? "./data/arciin"
  const paths = getStoragePaths(storageRoot)
  const folderSlug = slugify(def.folderName)

  const libraries = await prisma.library.findMany({
    where: { slug: { in: [...MEDIA_LIBRARY_SLUGS] } },
    orderBy: { slug: "asc" },
  })

  const folders: ConnectorFolderStatus[] = []
  for (const library of libraries) {
    const folder = await findConnectorFolder(prisma, library.id, def.folderName)
    folders.push({
      libraryId: library.id,
      librarySlug: library.slug,
      libraryName: library.name,
      folderId: folder?.id ?? null,
      folderPath: folder ? `${library.slug}/${folder.pathCache}` : `${library.slug}/${folderSlug}`,
      ready: Boolean(folder),
    })
  }

  return {
    enabled: integration.enabled,
    folders,
    storageRoot,
    mirrorRootHint: paths.librariesDir,
  }
}

async function mirrorAsset(ctx: {
  storageRoot: string
  library: Library
  folder: Folder
  asset: Asset
  storageObject: StorageObject
}): Promise<string> {
  const { storageRoot, library, folder, asset, storageObject } = ctx
  await ensureStorageDirectories(storageRoot)

  const filename = safeFilename(asset.originalFilename)
  const destDir = path.join(storageRoot, "libraries", library.slug, folder.pathCache)
  await mkdir(destDir, { recursive: true })

  const destPath = await uniqueMirrorPath(destDir, filename)

  try {
    await link(storageObject.physicalPath, destPath)
  } catch {
    await copyFile(storageObject.physicalPath, destPath)
  }

  return path.relative(storageRoot, destPath)
}

export async function syncAssetToConnectorMirror(
  prisma: PrismaClient,
  assetId: string,
  def: MediaConnectorDef,
): Promise<string | null> {
  if (!(await isConnectorEnabled(prisma, def))) return null

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
    include: { library: true, folder: true, storageObject: true },
  })

  if (!asset?.folder || !assetIsInConnectorFolder(asset.folder, def.folderName)) {
    return null
  }

  if (!MEDIA_LIBRARY_SLUGS.includes(asset.library.slug as (typeof MEDIA_LIBRARY_SLUGS)[number])) {
    return null
  }

  const instance = await prisma.instanceConfig.findFirst()
  const storageRoot = instance?.storageRoot ?? "./data/arciin"

  if (asset.libraryMirrorPath) {
    await unlink(path.join(storageRoot, asset.libraryMirrorPath)).catch(() => {})
  }

  const mirrorPath = await mirrorAsset({
    storageRoot,
    library: asset.library,
    folder: asset.folder,
    asset,
    storageObject: asset.storageObject,
  })

  await prisma.asset.update({
    where: { id: asset.id },
    data: { libraryMirrorPath: mirrorPath },
  })

  return mirrorPath
}

export async function clearAssetConnectorMirror(prisma: PrismaClient, assetId: string): Promise<void> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId },
    select: { libraryMirrorPath: true },
  })
  if (!asset?.libraryMirrorPath) return

  const instance = await prisma.instanceConfig.findFirst()
  const storageRoot = instance?.storageRoot ?? "./data/arciin"
  await unlink(path.join(storageRoot, asset.libraryMirrorPath)).catch(() => {})
  await prisma.asset.update({
    where: { id: assetId },
    data: { libraryMirrorPath: null },
  })
}

export async function resolveConnectorFolderId(
  prisma: PrismaClient,
  libraryId: string,
  librarySlug: string,
  def: MediaConnectorDef,
): Promise<string | null> {
  if (!(await isConnectorEnabled(prisma, def))) return null
  if (!MEDIA_LIBRARY_SLUGS.includes(librarySlug as (typeof MEDIA_LIBRARY_SLUGS)[number])) {
    return null
  }
  const folder = await findConnectorFolder(prisma, libraryId, def.folderName)
  return folder?.id ?? null
}

/** Plex wins when both connectors are enabled; otherwise Jellyfin. */
export async function resolveMediaConnectorUploadFolderId(
  prisma: PrismaClient,
  libraryId: string,
  librarySlug: string,
  explicitFolderId: string | undefined,
  plexDef: MediaConnectorDef,
  jellyfinDef: MediaConnectorDef,
): Promise<string | null | undefined> {
  if (explicitFolderId) return explicitFolderId
  const plexId = await resolveConnectorFolderId(prisma, libraryId, librarySlug, plexDef)
  if (plexId) return plexId
  return resolveConnectorFolderId(prisma, libraryId, librarySlug, jellyfinDef)
}

export async function syncAssetToEnabledConnectorMirrors(
  prisma: PrismaClient,
  assetId: string,
  plexDef: MediaConnectorDef,
  jellyfinDef: MediaConnectorDef,
): Promise<void> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
    include: { folder: true },
  })
  if (!asset?.folder) return

  if (assetIsInConnectorFolder(asset.folder, plexDef.folderName)) {
    await syncAssetToConnectorMirror(prisma, assetId, plexDef)
    return
  }
  if (assetIsInConnectorFolder(asset.folder, jellyfinDef.folderName)) {
    await syncAssetToConnectorMirror(prisma, assetId, jellyfinDef)
  }
}

export async function clearAssetMirrorIfLeavingConnectorFolders(
  prisma: PrismaClient,
  assetId: string,
  targetFolder: Folder | null,
  plexDef: MediaConnectorDef,
  jellyfinDef: MediaConnectorDef,
): Promise<void> {
  const inPlex = assetIsInConnectorFolder(targetFolder, plexDef.folderName)
  const inJellyfin = assetIsInConnectorFolder(targetFolder, jellyfinDef.folderName)
  if (!inPlex && !inJellyfin) {
    await clearAssetConnectorMirror(prisma, assetId)
  }
}
