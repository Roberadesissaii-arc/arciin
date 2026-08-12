#!/usr/bin/env node
/**
 * Reconcile assets whose bytes are gone from disk.
 *
 * Background: emptying the trash used to delete storage objects that other,
 * live assets still referenced (fixed in 37ded9d, 2026-08-10). Assets orphaned
 * before that fix still sit in the database marked READY, so the UI offers
 * downloads that 404 and thumbnails that never resolve to a file.
 *
 * What this does, in order:
 *
 *   1. Finds every non-deleted asset whose StorageObject path is absent.
 *   2. Tries to recover the bytes by checksum from backup snapshots, the dev
 *      storage root, library mirrors, and temp — any location holding a file
 *      whose name matches the recorded SHA-256.
 *   3. Marks whatever cannot be recovered as FAILED with an explanation.
 *
 * What it deliberately does NOT do:
 *
 *   - It never writes a thumbnail back as if it were the original. A 400px
 *     WebP is not the photograph someone uploaded, and silently substituting
 *     one would turn missing data into wrong data — the worse failure.
 *   - It never deletes the asset row. The filename, size, timestamps and
 *     thumbnail are the only remaining record that the file existed, and the
 *     owner may want to re-upload against it.
 *   - It never marks anything READY.
 *
 * Usage:
 *   node scripts/repair-missing-assets.mjs            # dry run (default)
 *   node scripts/repair-missing-assets.mjs --apply    # write changes
 */

import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

import { PrismaClient } from "@prisma/client"

const APPLY = process.argv.includes("--apply")
const prisma = new PrismaClient()

const STORAGE_ROOT = process.env.ARCIIN_DATA_DIR || "/srv/arciin-storage/arciin"
const BACKUP_ROOT = "/srv/arce-projects/arciin-backups"
const DEV_ROOT = "/srv/arce-projects/arciin-dev-storage"

const FAILURE_REASON =
  "Original file missing from storage. Lost before the 2026-08-10 trash fix, " +
  "which allowed emptying the trash to delete objects still referenced by live assets. " +
  "No copy was found in backups; re-upload to restore."

/** Every directory that might still hold an original, newest backup first. */
function recoverySearchRoots() {
  const roots = []
  if (existsSync(BACKUP_ROOT)) {
    for (const snapshot of readdirSync(BACKUP_ROOT).sort().reverse()) {
      const objects = path.join(BACKUP_ROOT, snapshot, "storage", "objects")
      if (existsSync(objects)) roots.push(objects)
    }
  }
  for (const extra of [
    path.join(DEV_ROOT, "objects"),
    path.join(STORAGE_ROOT, "temp"),
    path.join(STORAGE_ROOT, "libraries"),
  ]) {
    if (existsSync(extra)) roots.push(extra)
  }
  return roots
}

/** Map checksum → first file found carrying it, by filename convention. */
function indexBySha(roots) {
  const index = new Map()
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        const sha = entry.name.split(".")[0]
        if (sha.length === 64 && !index.has(sha)) index.set(sha, full)
      }
    }
  }
  for (const root of roots) walk(root)
  return index
}

/**
 * Confirm a candidate really is the file before restoring it.
 *
 * The filename claims a checksum; this checks it. Restoring a mislabelled file
 * would put the wrong bytes behind a real filename, which is worse than the
 * gap it replaces.
 */
function verifiedMatch(candidatePath, expectedSha) {
  try {
    const actual = createHash("sha256").update(readFileSync(candidatePath)).digest("hex")
    return actual === expectedSha
  } catch {
    return false
  }
}

async function main() {
  const assets = await prisma.asset.findMany({
    where: { deletedAt: null },
    include: { storageObject: true, library: { select: { slug: true } } },
  })

  const missing = assets.filter((asset) => !existsSync(asset.storageObject.physicalPath))

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — scanned ${assets.length} live assets`)
  console.log(`missing bytes on disk: ${missing.length}`)
  if (missing.length === 0) {
    await prisma.$disconnect()
    return
  }

  const index = indexBySha(recoverySearchRoots())
  console.log(`recovery index: ${index.size} distinct checksums across backups and dev storage`)

  const recoverable = []
  const unrecoverable = []

  for (const asset of missing) {
    const candidate = index.get(asset.checksumSha256)
    if (candidate && verifiedMatch(candidate, asset.checksumSha256)) {
      recoverable.push({ asset, source: candidate })
    } else {
      unrecoverable.push(asset)
    }
  }

  console.log(`recoverable (checksum-verified): ${recoverable.length}`)
  console.log(`unrecoverable:                   ${unrecoverable.length}`)

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  mkdirSync("reports", { recursive: true })

  // Snapshot before any write, so the change is reversible from the report.
  const snapshot = missing.map((asset) => ({
    assetId: asset.id,
    filename: asset.originalFilename,
    checksum: asset.checksumSha256,
    sizeBytes: Number(asset.sizeBytes),
    statusBefore: asset.status,
    processingErrorBefore: asset.processingError,
    library: asset.library.slug,
    createdAt: asset.createdAt.toISOString(),
    physicalPath: asset.storageObject.physicalPath,
    recoverable: Boolean(recoverable.find((r) => r.asset.id === asset.id)),
  }))
  const snapshotPath = `reports/missing-assets-snapshot-${stamp}.json`
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 1))
  console.log(`snapshot written: ${snapshotPath}`)

  if (!APPLY) {
    console.log("\nno changes written. re-run with --apply")
    await prisma.$disconnect()
    return
  }

  let restored = 0
  for (const { asset, source } of recoverable) {
    mkdirSync(path.dirname(asset.storageObject.physicalPath), { recursive: true })
    copyFileSync(source, asset.storageObject.physicalPath)
    restored += 1
  }

  const ids = unrecoverable.map((asset) => asset.id)
  const marked = ids.length
    ? await prisma.asset.updateMany({
        // Guarded on READY so a concurrent edit is never overwritten.
        where: { id: { in: ids }, status: "READY" },
        data: { status: "FAILED", processingError: FAILURE_REASON },
      })
    : { count: 0 }

  console.log(`\nrestored from backup: ${restored}`)
  console.log(`marked FAILED:        ${marked.count}`)
  console.log(`rollback: reports/missing-assets-snapshot-${stamp}.json holds every previous status`)

  await prisma.$disconnect()
}

main().catch(async (error) => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
