#!/usr/bin/env node
/**
 * Copy Documents *metadata* from the live instance into the dev instance.
 *
 * The organisation workflow is judged on real filenames — "The Atlantis World
 * (1)", "Strength Training 2nd Edition", a zero-byte "The Love Hypothesis.pdf"
 * — because those are what make classification, duplicate detection and the
 * damaged-file check hard. Five invented files prove nothing.
 *
 * Only names, sizes and types are copied. No file bytes are read or written,
 * and the production database is opened read-only in intent: this script issues
 * SELECTs against it and writes exclusively to arciin_dev.
 *
 * Refuses to run in the wrong direction.
 */

import path from "node:path"
import { config as loadEnv } from "dotenv"
import { PrismaClient } from "@prisma/client"

const repoRoot = path.resolve(import.meta.dirname, "..")
loadEnv({ path: path.join(repoRoot, ".env"), quiet: true })
const PROD_URL = process.env.DATABASE_URL
loadEnv({ path: path.join(repoRoot, ".env.development"), override: true, quiet: true })
const DEV_URL = process.env.DATABASE_URL

function databaseName(url) {
  return new URL(url).pathname.replace(/^\//, "")
}

if (databaseName(PROD_URL) !== "arciin") {
  throw new Error(`expected source "arciin", got "${databaseName(PROD_URL)}"`)
}
if (databaseName(DEV_URL) !== "arciin_dev") {
  throw new Error(`refusing to write to "${databaseName(DEV_URL)}"`)
}

const prod = new PrismaClient({ datasources: { db: { url: PROD_URL } } })
const dev = new PrismaClient({ datasources: { db: { url: DEV_URL } } })

try {
  const prodDocs = await prod.library.findFirst({ where: { slug: "documents" } })
  if (!prodDocs) throw new Error("no Documents library in the source instance")

  const [assets, folders] = await Promise.all([
    prod.asset.findMany({
      where: { libraryId: prodDocs.id, deletedAt: null },
      select: {
        originalFilename: true,
        mimeType: true,
        mediaType: true,
        extension: true,
        sizeBytes: true,
        title: true,
      },
      orderBy: { originalFilename: "asc" },
    }),
    prod.folder.findMany({
      where: { libraryId: prodDocs.id, deletedAt: null },
      select: { name: true, slug: true, pathCache: true },
      orderBy: { name: "asc" },
    }),
  ])

  const devDocs = await dev.library.findFirst({ where: { slug: "documents" } })
  if (!devDocs) throw new Error("no Documents library in the dev instance — seed it first")
  const owner = await dev.user.findFirst({ where: { role: "OWNER" } })
  if (!owner) throw new Error("no owner in the dev instance")
  const location = await dev.storageLocation.findFirst()
  if (!location) throw new Error("no storage location in the dev instance")

  // Start from a clean Documents library so a re-run is not cumulative. The
  // storage rows go too: deleting an asset leaves its StorageObject behind,
  // and those carry the unique object keys this script generates.
  await dev.asset.deleteMany({ where: { libraryId: devDocs.id } })
  await dev.folder.deleteMany({ where: { libraryId: devDocs.id } })
  await dev.storageObject.deleteMany({ where: { objectKey: { startsWith: "objects/devseed/" } } })

  // Unique per run, so a crashed run cannot poison the next one.
  const runId = Date.now().toString(36)

  for (const folder of folders) {
    await dev.folder.create({
      data: {
        libraryId: devDocs.id,
        name: folder.name,
        slug: folder.slug,
        pathCache: folder.pathCache,
      },
    })
  }

  let n = 0
  for (const asset of assets) {
    n += 1
    const checksum = `devseed${runId}${String(n).padStart(57 - runId.length, "0")}`
    const object = await dev.storageObject.create({
      data: {
        storageLocationId: location.id,
        objectKey: `objects/devseed/${runId}/${n}/${checksum}.bin`,
        // Deliberately a path that holds no bytes: this instance is for
        // exercising organisation, never for reading file contents.
        physicalPath: `${location.rootPath}/objects/devseed/${checksum}.bin`,
        sizeBytes: asset.sizeBytes,
        checksumSha256: checksum,
        mimeType: asset.mimeType,
      },
    })
    await dev.asset.create({
      data: {
        libraryId: devDocs.id,
        folderId: null,
        storageObjectId: object.id,
        ownerId: owner.id,
        filename: `${checksum}.${asset.extension}`,
        originalFilename: asset.originalFilename,
        title: asset.title,
        mimeType: asset.mimeType,
        mediaType: asset.mediaType,
        extension: asset.extension,
        sizeBytes: asset.sizeBytes,
        checksumSha256: checksum,
        status: "READY",
      },
    })
  }

  console.log(`copied ${assets.length} document names and ${folders.length} folders into arciin_dev`)
} finally {
  await prod.$disconnect()
  await dev.$disconnect()
}
