import { access, copyFile, link, mkdir, unlink } from "node:fs/promises"
import path from "node:path"

import type { Asset, Folder, Library, PrismaClient, StorageObject } from "@prisma/client"
import { prisma } from "@arciin/database"
import { MEDIA_LIBRARY_SLUGS, mirrorFilenameForDisk, normalizeConfiguredStorageRoot } from "@arciin/shared"

import { workerConfig } from "@/config"

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
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

async function mirrorAsset(ctx: {
  storageRoot: string
  library: Library
  folder: Folder
  asset: Asset
  storageObject: StorageObject
}): Promise<string> {
  const { storageRoot, library, folder, asset, storageObject } = ctx
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

async function syncForFolderName(
  db: PrismaClient,
  assetId: string,
  folderName: string,
  isEnabled: () => Promise<boolean>,
): Promise<string | null> {
  if (!(await isEnabled())) return null

  const asset = await db.asset.findFirst({
    where: { id: assetId, deletedAt: null },
    include: { library: true, folder: true, storageObject: true },
  })

  if (!asset?.folder || asset.folder.slug !== slugify(folderName)) return null
  if (!MEDIA_LIBRARY_SLUGS.includes(asset.library.slug as (typeof MEDIA_LIBRARY_SLUGS)[number])) {
    return null
  }

  const instance = await db.instanceConfig.findFirst()
  const storageRoot = normalizeConfiguredStorageRoot(
    instance?.storageRoot,
    path.resolve(workerConfig.ARCIIN_DATA_DIR),
  )

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

  await db.asset.update({
    where: { id: asset.id },
    data: { libraryMirrorPath: mirrorPath },
  })

  return mirrorPath
}

/** Re-mirror after processing so Plex/Jellyfin get a file with a proper extension. */
export async function syncConnectorMirrorsForAsset(assetId: string): Promise<string | null> {
  const plex = await syncForFolderName(prisma, assetId, "Plex", async () => {
    const row = await prisma.integration.findFirst({ where: { type: "PLEX" } })
    return Boolean(row?.enabled)
  })
  if (plex) return plex

  return syncForFolderName(prisma, assetId, "Jellyfin", async () => {
    const row = await prisma.integration.findFirst({ where: { id: "jellyfin-connector" } })
    return Boolean(row?.enabled)
  })
}
