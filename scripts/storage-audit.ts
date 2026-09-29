/**
 * Read-only storage usage audit, for operators.
 *
 *   pnpm storage:audit            # human summary
 *   pnpm storage:audit --json     # the same numbers the Database page shows
 *
 * Counts only. Nothing is deleted, moved or rewritten; symlinks are never
 * followed. Uses the same code as the owner/admin audit in the app.
 */
import path from "node:path"

import { config as loadEnv } from "dotenv"
import { PrismaClient } from "@prisma/client"

import { normalizeConfiguredStorageRoot } from "@arciin/storage"

import { auditStorage, storageAuditRoots } from "../apps/api/src/services/storage/storage-audit"

loadEnv()

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`
const pair = (x: { count: number; bytes: number }) => `${x.count.toLocaleString()} / ${gb(x.bytes)}`

async function main() {
  const prisma = new PrismaClient()
  try {
    const instance = await prisma.instanceConfig.findFirst({ select: { storageRoot: true } })
    const root = normalizeConfiguredStorageRoot(instance?.storageRoot, path.resolve(process.env.ARCIIN_DATA_DIR ?? "/srv/arciin-storage/arciin"))
    const a = await auditStorage({ prisma, ...storageAuditRoots(root) })
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(a, null, 2))
      return
    }
    const lines = [
      `Arciin storage audit (read-only) — ${a.generatedAt}, ${(a.durationMs / 1000).toFixed(1)} s${a.truncated ? " — BUDGET REACHED, numbers are a lower bound" : ""}`,
      a.filesystem
        ? `Filesystem: ${gb(a.filesystem.usedBytes)} used of ${gb(a.filesystem.totalBytes)}, ${gb(a.filesystem.freeBytes)} free`
        : "Filesystem: unavailable",
      `Database size: ${a.database.sizeBytes == null ? "unavailable" : gb(a.database.sizeBytes)}`,
      `Storage objects (rows): ${pair(a.database.storageObjects)}`,
      `  active ${pair(a.database.byState.active)} · archived ${pair(a.database.byState.archived)} · failed uploads ${pair(a.database.byState.failed)} · trash ${pair(a.database.byState.trash)}`,
      `  orphan candidates ${pair(a.database.orphanCandidates)} · recent unreferenced ${pair(a.database.recentUnreferenced)}`,
      `  rows whose file is missing: ${a.database.missingFiles} · stored elsewhere: ${a.database.elsewhere}`,
      `objects/ on disk: ${a.physical.objects.files.toLocaleString()} files, ${gb(a.physical.objects.uniqueBytes)} · unreferenced files ${pair(a.physical.objects.orphanCandidates)}`,
      `thumbnails: ${gb(a.physical.thumbnails.uniqueBytes)} · temp: ${gb(a.physical.temp.uniqueBytes)} · partial uploads: ${a.physical.resumablePartials.files} (${a.physical.resumablePartials.withActiveUpload} active, ${a.physical.resumablePartials.stale} stale), ${gb(a.physical.resumablePartials.uniqueBytes)}`,
      `logs: storage ${gb(a.physical.storageLogs.uniqueBytes)} · app ${gb(a.physical.appLogs.uniqueBytes)} · other storage dirs ${gb(a.physical.other.uniqueBytes)}`,
      a.backups?.available
        ? `backups: ${a.backups.snapshots} snapshots · ${gb(a.backups.apparentBytes)} as listed · ${gb(a.backups.uniqueBytes)} on disk (hard links counted once) · ${gb(a.backups.sharedWithStorageBytes)} shared with live storage`
        : "backups: not found",
      a.ollamaModels?.available ? `Ollama models: ${gb(a.ollamaModels.uniqueBytes)}` : "Ollama models: not readable",
      "Nothing was changed.",
    ]
    console.log(lines.join("\n"))
  } finally {
    await prisma.$disconnect()
  }
}

void main()
