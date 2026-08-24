#!/usr/bin/env node
/**
 * Reconcile database/storage state that earlier bugs left behind.
 *
 *   node scripts/reconcile-storage.mjs              # dry run, changes nothing
 *   node scripts/reconcile-storage.mjs --apply      # apply the safe repairs
 *   node scripts/reconcile-storage.mjs --apply --json
 *
 * Two conditions, deliberately treated differently.
 *
 * **Assets stranded in a deleted folder.** Folder deletion used to soft-delete
 * the folder rows and leave every asset pointing at one. Listings hide assets
 * whose folder is deleted, and Trash only shows assets with their own
 * `deletedAt`, so the file appeared in neither while staying alive on disk.
 * The folder dialog promises "Files stay in place", so the repair is to move
 * them to the library root — the same thing the fixed delete path now does.
 * This is reversible and touches no bytes.
 *
 * **StorageObject rows no asset references.** These are *reported*, never
 * deleted. A row with no asset can be failed-upload residue, or it can be the
 * only remaining pointer to bytes a future repair could re-link — and content
 * addressing means one object may be shared. Deleting on a guess is how a
 * library ends up full of placeholders, so this half prints evidence and stops.
 * Removing bytes stays a human decision.
 */

import { PrismaClient } from "@prisma/client"
import { config as loadEnv } from "dotenv"
import { access, stat } from "node:fs/promises"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dirname, "..")
loadEnv({ path: path.join(repoRoot, ".env"), quiet: true })
if (process.env.ARCIIN_ENV_NAMESPACE && process.env.ARCIIN_ENV_NAMESPACE !== "production") {
  loadEnv({ path: path.join(repoRoot, ".env.development"), override: true, quiet: true })
}

const APPLY = process.argv.includes("--apply")
const AS_JSON = process.argv.includes("--json")
const prisma = new PrismaClient()

function say(...parts) {
  if (!AS_JSON) console.log(...parts)
}

async function fileSize(p) {
  try {
    await access(p)
    return (await stat(p)).size
  } catch {
    return null
  }
}

async function findStrandedAssets() {
  const rows = await prisma.asset.findMany({
    where: {
      deletedAt: null,
      folderId: { not: null },
      folder: { deletedAt: { not: null } },
    },
    select: {
      id: true,
      originalFilename: true,
      libraryId: true,
      folderId: true,
      folder: { select: { name: true, deletedAt: true } },
      library: { select: { slug: true } },
    },
  })
  return rows
}

async function findUnreferencedObjects() {
  const rows = await prisma.storageObject.findMany({
    where: { assets: { none: {} } },
    select: { id: true, physicalPath: true, sizeBytes: true, mimeType: true, createdAt: true },
  })
  return rows
}

const stranded = await findStrandedAssets()
const orphans = await findUnreferencedObjects()

say(`\nStranded assets (alive, but inside a deleted folder): ${stranded.length}`)
for (const a of stranded) {
  say(
    `  ${a.id}  ${a.originalFilename}` +
      `\n      library=${a.library?.slug ?? "?"} folder="${a.folder?.name ?? "?"}" deleted=${
        a.folder?.deletedAt?.toISOString() ?? "?"
      }`,
  )
}

say(`\nStorageObjects no asset references: ${orphans.length}  (reported only, never deleted)`)
let orphanBytes = 0n
let onDisk = 0
for (const o of orphans) {
  const size = await fileSize(o.physicalPath)
  if (size !== null) onDisk += 1
  orphanBytes += BigInt(o.sizeBytes ?? 0)
}
say(`  ${onDisk} of ${orphans.length} still have bytes on disk, ${Number(orphanBytes) / 1_048_576} MB recorded`)
say("  Not removed: a shared or re-linkable object cannot be told from garbage here.")

let repaired = 0
if (APPLY && stranded.length > 0) {
  // Metadata first, so the previous parent is recoverable from the log.
  say("\nBefore/after (previous folderId is recorded here):")
  for (const a of stranded) {
    say(`  ${a.id}  folderId ${a.folderId} -> null (library root)`)
  }
  const result = await prisma.asset.updateMany({
    where: { id: { in: stranded.map((a) => a.id) } },
    data: { folderId: null },
  })
  repaired = result.count
  say(`\nMoved ${repaired} asset(s) to their library root.`)
} else if (stranded.length > 0) {
  say("\nDry run — nothing changed. Re-run with --apply to move these to the library root.")
} else {
  say("\nNothing to repair.")
}

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        applied: APPLY,
        strandedAssets: stranded.map((a) => ({ id: a.id, filename: a.originalFilename })),
        repaired,
        unreferencedStorageObjects: orphans.length,
        unreferencedOnDisk: onDisk,
      },
      null,
      2,
    ),
  )
}

await prisma.$disconnect()
