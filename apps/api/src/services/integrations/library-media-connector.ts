import { constants as fsConstants } from "node:fs"
import { access, copyFile, link, mkdir, unlink } from "node:fs/promises"
import path from "node:path"

import type { Asset, Folder, Integration, Library, PrismaClient, StorageObject } from "@prisma/client"

import { MEDIA_LIBRARY_SLUGS } from "@arciin/shared"
import { mirrorFilenameForDisk } from "@arciin/storage"

import { computeConnectorHealth, type ConnectorHealth } from "@/services/integrations/connector-health"
import { slugify } from "@/services/slug"
import { resolveEffectiveStorageRoot } from "@/services/storage/effective-storage-root"
import { ensureStorageDirectories, getStoragePaths } from "@/services/storage/local-storage"

export { MEDIA_LIBRARY_SLUGS }
export { computeConnectorHealth }
export type { ConnectorHealth }

export type ConnectorFolderStatus = {
  libraryId: string
  librarySlug: string
  libraryName: string
  folderId: string | null
  folderPath: string
  ready: boolean
  /** The mirror directory the media server scans exists and is writable. */
  onDisk: boolean
}

export type ConnectorStatus = {
  enabled: boolean
  health: ConnectorHealth
  folders: ConnectorFolderStatus[]
  storageRoot: string
  mirrorRootHint: string
}

async function isWritableDirectory(dir: string): Promise<boolean> {
  try {
    await access(dir, fsConstants.W_OK | fsConstants.X_OK)
    return true
  } catch {
    return false
  }
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

  const instance = await prisma.instanceConfig.findFirst()
  const storageRoot = resolveEffectiveStorageRoot(instance?.storageRoot)
  await ensureStorageDirectories(storageRoot)

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

    const diskDir = path.join(storageRoot, "libraries", library.slug, folder.pathCache)
    await mkdir(diskDir, { recursive: true })

    folders.push({
      libraryId: library.id,
      librarySlug: library.slug,
      libraryName: library.name,
      folderId: folder.id,
      folderPath: `${library.slug}/${folder.pathCache}`,
      ready: true,
      onDisk: true,
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
  const storageRoot = resolveEffectiveStorageRoot(instance?.storageRoot)
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
      onDisk: folder
        ? await isWritableDirectory(path.join(paths.librariesDir, library.slug, folder.pathCache))
        : false,
    })
  }

  const displayName = def.folderName
  const health = computeConnectorHealth({
    enabled: integration.enabled,
    displayName,
    mirrorRootWritable: await isWritableDirectory(paths.librariesDir),
    folders,
  })

  return {
    enabled: integration.enabled,
    health,
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

  const filename = mirrorFilenameForDisk(asset.originalFilename, {
    extension: asset.extension,
    mimeType: asset.mimeType,
  })
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
  const storageRoot = resolveEffectiveStorageRoot(instance?.storageRoot)

  if (asset.libraryMirrorPath) {
    await unlinkMirrorWithinRoot(storageRoot, asset.libraryMirrorPath)
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

/**
 * Resolve a stored mirror path against the storage root, refusing anything that
 * lands outside it.
 *
 * `libraryMirrorPath` is written by mirrorAsset() from a sanitized filename, so
 * today it is always inside the root. It is still a database value being handed
 * to unlink(), and the cost of that assumption being wrong once — a stray `..`
 * from a future writer, a hand-edited row, a restored backup — is deleting an
 * arbitrary file as the service user. Cheap to check, unbounded to miss.
 */
export function resolveMirrorPathWithinRoot(
  storageRoot: string,
  mirrorPath: string,
): string | null {
  const root = path.resolve(storageRoot)
  const resolved = path.resolve(root, mirrorPath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null
  return resolved
}

/** Remove a mirrored file, but only when it really is under the storage root. */
async function unlinkMirrorWithinRoot(storageRoot: string, mirrorPath: string): Promise<void> {
  const resolved = resolveMirrorPathWithinRoot(storageRoot, mirrorPath)
  if (!resolved) {
    console.warn(
      `[library-mirror] refusing to unlink a mirror path outside the storage root: ${mirrorPath}`,
    )
    return
  }
  await unlink(resolved).catch(() => {})
}

export async function clearAssetConnectorMirror(prisma: PrismaClient, assetId: string): Promise<void> {
  const asset = await prisma.asset.findFirst({
    where: { id: assetId },
    select: { libraryMirrorPath: true },
  })
  if (!asset?.libraryMirrorPath) return

  const instance = await prisma.instanceConfig.findFirst()
  const storageRoot = resolveEffectiveStorageRoot(instance?.storageRoot)
  await unlinkMirrorWithinRoot(storageRoot, asset.libraryMirrorPath)
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

/** Use explicit folder when provided; otherwise library root (not connector folders). */
export async function resolveMediaConnectorUploadFolderId(
  _prisma: PrismaClient,
  _libraryId: string,
  _librarySlug: string,
  explicitFolderId: string | undefined,
): Promise<string | null | undefined> {
  if (explicitFolderId) return explicitFolderId
  return null
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
