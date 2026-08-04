/**
 * Report-only storage integrity scanner.
 *
 *   pnpm tsx scripts/storage-integrity-scan.ts
 *   pnpm tsx scripts/storage-integrity-scan.ts --apply --issue temp --older-than 24
 *
 * Report mode is the default and the only mode that runs without an explicit
 * selection. Orphaned storage objects and stray physical files are **never**
 * deleted by this script — they are reported for a human, because a
 * content-addressed object may be referenced by a row this scan cannot see.
 *
 * The only class it will delete, and only with `--apply --issue temp`, is
 * stale temporary files, judged by the same unit-tested policy the scheduled
 * worker job uses.
 */
import { lstat, mkdir, readdir, readlink, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { config as loadEnv } from "dotenv"

import { PrismaClient } from "@prisma/client"
import { DEFAULT_TEMP_MAX_AGE_HOURS, planTempCleanup } from "@arciin/shared"

loadEnv()

const prisma = new PrismaClient()

type Args = {
  apply: boolean
  issue?: string
  olderThanHours: number
}

function parseArgs(argv: string[]): Args {
  const at = (flag: string) => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const olderThan = Number(at("--older-than"))
  return {
    apply: argv.includes("--apply"),
    issue: at("--issue"),
    olderThanHours:
      Number.isFinite(olderThan) && olderThan > 0 ? olderThan : DEFAULT_TEMP_MAX_AGE_HOURS,
  }
}

function storageRoot(): string {
  return path.resolve(process.env.ARCIIN_DATA_DIR ?? "/srv/arciin-storage/arciin")
}

async function scanTempFiles(root: string, olderThanHours: number) {
  const tempDir = path.resolve(root, "temp")
  const candidates: Array<{
    path: string
    mtimeMs: number
    sizeBytes: number
    escapesRoot?: boolean
  }> = []

  let entries: Awaited<ReturnType<typeof readdir>> = []
  try {
    entries = await readdir(tempDir)
  } catch {
    return { tempDir, plan: planTempCleanup([], { tempRoot: tempDir, now: Date.now() }) }
  }

  for (const entry of entries) {
    const entryPath = path.join(tempDir, String(entry))
    try {
      const stat = await lstat(entryPath)
      if (stat.isSymbolicLink()) {
        const target = path.resolve(tempDir, await readlink(entryPath))
        candidates.push({
          path: entryPath,
          mtimeMs: stat.mtimeMs,
          sizeBytes: 0,
          escapesRoot: !target.startsWith(`${tempDir}/`),
        })
        continue
      }
      if (!stat.isFile()) continue
      candidates.push({ path: entryPath, mtimeMs: stat.mtimeMs, sizeBytes: stat.size })
    } catch {
      /* unreadable entry — skipped, and therefore never deleted */
    }
  }

  return {
    tempDir,
    plan: planTempCleanup(candidates, {
      tempRoot: tempDir,
      now: Date.now(),
      maxAgeHours: olderThanHours,
    }),
  }
}

async function scanDatabaseIntegrity() {
  const [orphanObjects, liveAssets, referencedObjects] = await Promise.all([
    prisma.storageObject.findMany({
      where: { assets: { none: {} } },
      select: { id: true, sizeBytes: true },
    }),
    prisma.asset.count({ where: { deletedAt: null } }),
    // `Asset.storageObjectId` is a required FK, so an asset can never lack a
    // storage *row*. What can go wrong is the row pointing at bytes that are
    // gone, so check the physical files instead.
    prisma.storageObject.findMany({
      where: { assets: { some: { deletedAt: null } } },
      select: { id: true, physicalPath: true },
    }),
  ])

  let missingPhysicalFiles = 0
  const missingIds: string[] = []
  for (const object of referencedObjects) {
    try {
      await lstat(object.physicalPath)
    } catch {
      missingPhysicalFiles += 1
      missingIds.push(object.id)
    }
  }

  return {
    orphanStorageObjects: orphanObjects.length,
    orphanBytes: orphanObjects.reduce((total, o) => total + Number(o.sizeBytes), 0),
    orphanIds: orphanObjects.map((o) => o.id),
    referencedObjects: referencedObjects.length,
    missingPhysicalFiles,
    missingPhysicalFileIds: missingIds,
    liveAssets,
  }
}

function mb(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const root = storageRoot()

  if (args.apply && args.issue !== "temp") {
    console.error(
      "Refusing to run: --apply supports only --issue temp.\n" +
        "Orphaned storage objects and stray files are report-only — a content-addressed\n" +
        "object may be referenced by a row this scan cannot see. Review them by hand.",
    )
    process.exitCode = 1
    return
  }

  const { tempDir, plan } = await scanTempFiles(root, args.olderThanHours)
  const db = await scanDatabaseIntegrity()

  console.log("\nArciin storage integrity scan")
  console.log("─".repeat(66))
  console.log(`mode:          ${args.apply ? `APPLY (${args.issue})` : "REPORT ONLY"}`)
  console.log(`storage root:  ${root}`)
  console.log(`temp retention: ${args.olderThanHours}h`)
  console.log("")
  console.log("Temporary files")
  console.log(`  examined:    ${plan.deletable.length + plan.retained.length}`)
  console.log(`  stale:       ${plan.deletable.length} (${mb(plan.bytesRecoverable)} recoverable)`)
  console.log(`  retained:    ${plan.retained.length}`)
  for (const [reason, count] of Object.entries(
    plan.retained.reduce<Record<string, number>>((acc, r) => {
      acc[r.reason] = (acc[r.reason] ?? 0) + 1
      return acc
    }, {}),
  )) {
    console.log(`     - ${reason}: ${count}`)
  }
  console.log("")
  console.log("Database integrity")
  console.log(`  live assets:              ${db.liveAssets}`)
  console.log(`  orphan storage objects:   ${db.orphanStorageObjects} (${mb(db.orphanBytes)})`)
  console.log(`  referenced objects:       ${db.referencedObjects}`)
  console.log(`  missing physical files:   ${db.missingPhysicalFiles}`)

  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const manifestPath = path.resolve(process.cwd(), "reports", `storage-scan-${stamp}.json`)
  await mkdir(path.dirname(manifestPath), { recursive: true })
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        scannedAt: new Date().toISOString(),
        storageRoot: root,
        tempDir,
        retentionHours: args.olderThanHours,
        temp: {
          // Basenames only: temp names are checksummed/randomised, but the
          // manifest still avoids carrying full paths around.
          deletable: plan.deletable.map((f) => ({
            name: path.basename(f.path),
            sizeBytes: f.sizeBytes,
            mtime: new Date(f.mtimeMs).toISOString(),
          })),
          bytesRecoverable: plan.bytesRecoverable,
          retained: plan.retained.map((r) => ({ name: path.basename(r.candidate.path), reason: r.reason })),
        },
        database: {
          liveAssets: db.liveAssets,
          orphanStorageObjects: db.orphanStorageObjects,
          orphanBytes: db.orphanBytes,
          orphanIds: db.orphanIds,
          referencedObjects: db.referencedObjects,
          missingPhysicalFiles: db.missingPhysicalFiles,
          missingPhysicalFileIds: db.missingPhysicalFileIds,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  console.log(`\nmanifest: ${manifestPath}`)

  if (!args.apply) {
    console.log("\nReport only — nothing was deleted.")
    console.log("To remove stale temp files:")
    console.log("  pnpm tsx scripts/storage-integrity-scan.ts --apply --issue temp --older-than 24")
    return
  }

  let deleted = 0
  let bytes = 0
  for (const file of plan.deletable) {
    try {
      await rm(file.path, { force: true })
      deleted += 1
      bytes += file.sizeBytes
    } catch (error) {
      console.error(`  ✗ ${path.basename(file.path)}: ${error instanceof Error ? error.message : error}`)
    }
  }

  console.log(`\nDeleted ${deleted} stale temp file(s), recovered ${mb(bytes)}.`)
  console.log("No storage object, asset, or database row was modified.")
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
