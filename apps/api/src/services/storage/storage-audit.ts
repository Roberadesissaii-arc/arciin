import { existsSync } from "node:fs"
import { lstat, readdir, statfs } from "node:fs/promises"
import path from "node:path"

import type { PrismaClient } from "@prisma/client"

/**
 * Where the disk went — read-only.
 *
 * The server sits above 80% and the only honest answer to "why" is to count.
 * This walks the storage root, the backup tree and a few known places, and
 * compares what is on disk with what the database says is there. It never
 * deletes, moves or rewrites anything, never follows a symlink, never takes a
 * path from a request (every root comes from server configuration), and stops
 * at a time and entry budget rather than holding a request for minutes.
 *
 * "Orphan" is used conservatively. A StorageObject is a candidate only when
 * no Asset row references it at all — one deleted asset is not enough, since
 * another may share the object — and it is older than the grace period, so an
 * upload between writing the object and writing its asset is never counted.
 * A file under objects/ is a candidate only when no StorageObject points at
 * it and it too is older than the grace period.
 *
 * The result holds labels and numbers, never an absolute path.
 */

export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000
const DEFAULT_BUDGET_MS = 120_000
const DEFAULT_MAX_ENTRIES = 500_000

export type TreeUsage = {
  /** Present and readable. */
  available: boolean
  files: number
  /** Sum of file sizes as listed (a hard-linked file counts once per name). */
  apparentBytes: number
  /** Each inode once: what the tree actually occupies. */
  uniqueBytes: number
  symlinksSkipped: number
  unreadable: number
  /** The budget ran out; numbers are a lower bound. */
  truncated: boolean
}

export type StorageAudit = {
  generatedAt: string
  durationMs: number
  truncated: boolean
  filesystem: { totalBytes: number; usedBytes: number; freeBytes: number } | null
  database: {
    sizeBytes: number | null
    storageObjects: { count: number; bytes: number }
    /** Unique objects, each counted once in the strongest state any of its assets is in. */
    byState: {
      active: { count: number; bytes: number }
      archived: { count: number; bytes: number }
      /** Referenced only by uploads that failed: usually the file never landed. */
      failed: { count: number; bytes: number }
      trash: { count: number; bytes: number }
    }
    orphanCandidates: { count: number; bytes: number }
    /** Unreferenced, but younger than the grace period: probably an upload in flight. */
    recentUnreferenced: { count: number; bytes: number }
    /** Rows whose file should be under this root's objects/ but is not there. */
    missingFiles: number
    /** Rows stored outside this storage root (another drive or location): not checked here. */
    elsewhere: number
  }
  physical: {
    objects: TreeUsage & { orphanCandidates: { count: number; bytes: number } }
    thumbnails: TreeUsage
    temp: TreeUsage
    resumablePartials: TreeUsage & { withActiveUpload: number; stale: number }
    storageLogs: TreeUsage
    appLogs: TreeUsage
    other: TreeUsage
  }
  backups: (TreeUsage & { snapshots: number; sharedWithStorageBytes: number }) | null
  ollamaModels: TreeUsage | null
}

type Walked = TreeUsage & { inodes: Set<string>; files_: Array<{ rel: string; size: number; mtimeMs: number; inode: string }> }

type Budget = { deadline: number; entries: number; maxEntries: number; exhausted: boolean }

function emptyUsage(available: boolean): TreeUsage {
  return { available, files: 0, apparentBytes: 0, uniqueBytes: 0, symlinksSkipped: 0, unreadable: 0, truncated: false }
}

/**
 * Every regular file under `root`, by lstat: symlinks are counted and skipped,
 * never followed, so nothing outside `root` is ever read. `exclude` names
 * direct children to leave out (they are measured separately).
 */
async function walk(
  root: string,
  budget: Budget,
  options: { keepFiles?: boolean; exclude?: string[]; seen?: Set<string> } = {},
): Promise<Walked> {
  const out: Walked = { ...emptyUsage(false), inodes: new Set(), files_: [] }
  const seen = options.seen ?? out.inodes
  try {
    const info = await lstat(root)
    if (!info.isDirectory()) return out
  } catch {
    return out
  }
  out.available = true
  const stack: string[] = [root]
  while (stack.length) {
    if (Date.now() >= budget.deadline || budget.entries >= budget.maxEntries) {
      budget.exhausted = true
      out.truncated = true
      break
    }
    const dir = stack.pop()!
    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      out.unreadable++
      continue
    }
    for (const entry of entries) {
      // Checked per entry too: objects/ is one flat directory of every file.
      if (budget.entries >= budget.maxEntries || Date.now() >= budget.deadline) {
        budget.exhausted = true
        out.truncated = true
        break
      }
      budget.entries++
      const full = path.join(dir, entry.name)
      if (dir === root && options.exclude?.includes(entry.name)) continue
      if (entry.isSymbolicLink()) {
        out.symlinksSkipped++
        continue
      }
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      let st: import("node:fs").Stats
      try {
        st = await lstat(full)
      } catch {
        out.unreadable++
        continue
      }
      const inode = `${st.dev}:${st.ino}`
      out.files++
      out.apparentBytes += st.size
      if (!seen.has(inode)) {
        seen.add(inode)
        out.uniqueBytes += st.size
      }
      out.inodes.add(inode)
      if (options.keepFiles) out.files_.push({ rel: path.relative(root, full), size: st.size, mtimeMs: st.mtimeMs, inode })
    }
  }
  return out
}

function usage(w: Walked): TreeUsage {
  return {
    available: w.available,
    files: w.files,
    apparentBytes: w.apparentBytes,
    uniqueBytes: w.uniqueBytes,
    symlinksSkipped: w.symlinksSkipped,
    unreadable: w.unreadable,
    truncated: w.truncated,
  }
}

export type StorageAuditDeps = {
  prisma: PrismaClient
  storageRoot: string
  /** Backup tree (ARCIIN_BACKUP_DIR). Omitted or unreadable: reported as unavailable. */
  backupDir?: string | null
  /** The application's own log directory (PM2 logs), if any. */
  appLogDir?: string | null
  ollamaModelsDir?: string | null
  now?: () => number
  budgetMs?: number
  maxEntries?: number
}

const KNOWN_STORAGE_DIRS = ["objects", "thumbnails", "temp", "logs"]

export async function auditStorage(deps: StorageAuditDeps): Promise<StorageAudit> {
  const now = deps.now ?? Date.now
  const started = now()
  const budget: Budget = {
    deadline: Date.now() + (deps.budgetMs ?? DEFAULT_BUDGET_MS),
    entries: 0,
    maxEntries: deps.maxEntries ?? DEFAULT_MAX_ENTRIES,
    exhausted: false,
  }
  const root = path.resolve(deps.storageRoot)
  const graceCutoff = new Date(now() - ORPHAN_GRACE_MS)

  // --- filesystem -----------------------------------------------------------
  let filesystem: StorageAudit["filesystem"] = null
  try {
    const fs = await statfs(root)
    const block = Number(fs.bsize)
    filesystem = {
      totalBytes: Number(fs.blocks) * block,
      usedBytes: (Number(fs.blocks) - Number(fs.bfree)) * block,
      freeBytes: Number(fs.bavail) * block,
    }
  } catch {
    filesystem = null
  }

  // --- database --------------------------------------------------------------
  const [objectTotals] = await deps.prisma.$queryRaw<Array<{ n: bigint; bytes: bigint | null }>>`
    SELECT count(*) AS n, sum("sizeBytes") AS bytes FROM "StorageObject"
  `
  const states = await deps.prisma.$queryRaw<Array<{ state: string; n: bigint; bytes: bigint | null }>>`
    SELECT state, count(*) AS n, sum(size) AS bytes FROM (
      SELECT o."sizeBytes" AS size,
        CASE
          WHEN EXISTS (SELECT 1 FROM "Asset" a WHERE a."storageObjectId" = o.id AND a."deletedAt" IS NULL AND a."archivedAt" IS NULL AND a.status <> 'FAILED') THEN 'active'
          WHEN EXISTS (SELECT 1 FROM "Asset" a WHERE a."storageObjectId" = o.id AND a."deletedAt" IS NULL AND a.status <> 'FAILED') THEN 'archived'
          WHEN EXISTS (SELECT 1 FROM "Asset" a WHERE a."storageObjectId" = o.id AND a."deletedAt" IS NULL) THEN 'failed'
          WHEN EXISTS (SELECT 1 FROM "Asset" a WHERE a."storageObjectId" = o.id) THEN 'trash'
          WHEN o."createdAt" < ${graceCutoff} THEN 'orphan'
          ELSE 'recent'
        END AS state
      FROM "StorageObject" o
    ) s
    GROUP BY state
  `
  const state = (name: string) => {
    const row = states.find((s) => s.state === name)
    return { count: Number(row?.n ?? 0), bytes: Number(row?.bytes ?? 0) }
  }
  let databaseSize: number | null = null
  try {
    const [row] = await deps.prisma.$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database()) AS size`
    databaseSize = Number(row?.size ?? 0)
  } catch {
    databaseSize = null
  }

  // --- physical: storage root -------------------------------------------------
  const objectsDir = path.join(root, "objects")
  const storageInodes = new Set<string>()
  const objects = await walk(objectsDir, budget, { keepFiles: true, seen: storageInodes })
  const thumbnails = await walk(path.join(root, "thumbnails"), budget, { seen: storageInodes })
  const resumableDir = path.join(root, "temp", "resumable")
  const resumable = await walk(resumableDir, budget, { keepFiles: true, seen: storageInodes })
  const temp = await walk(path.join(root, "temp"), budget, { exclude: ["resumable"], seen: storageInodes })
  const storageLogs = await walk(path.join(root, "logs"), budget, { seen: storageInodes })
  const other = await walk(root, budget, { exclude: KNOWN_STORAGE_DIRS, seen: storageInodes })
  const appLogs = deps.appLogDir ? usage(await walk(path.resolve(deps.appLogDir), budget)) : emptyUsage(false)

  // Files under objects/ that no StorageObject names.
  const referenced = new Set<string>()
  const rows = await deps.prisma.storageObject.findMany({ select: { physicalPath: true } })
  let missingFiles = 0
  let elsewhere = 0
  const onDisk = new Set(objects.files_.map((f) => f.rel))
  for (const row of rows) {
    const rel = path.relative(objectsDir, path.resolve(row.physicalPath))
    // Only paths inside this root's objects/ are compared.
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      elsewhere++
      continue
    }
    referenced.add(rel)
    if (!objects.truncated && !onDisk.has(rel)) missingFiles++
  }
  const physicalOrphans = objects.files_.filter((f) => !referenced.has(f.rel) && f.mtimeMs < graceCutoff.getTime())

  // Partials: which belong to an upload still in progress.
  const active = new Set(
    (
      await deps.prisma.resumableUpload.findMany({
        where: { status: "UPLOADING", expiresAt: { gt: new Date(now()) } },
        select: { id: true },
      })
    ).map((u) => u.id),
  )
  const partialIds = resumable.files_.map((f) => path.basename(f.rel).replace(/\.partial$/, ""))
  const withActiveUpload = partialIds.filter((id) => active.has(id)).length

  // --- backups ---------------------------------------------------------------
  let backups: StorageAudit["backups"] = null
  if (deps.backupDir) {
    const backupRoot = path.resolve(deps.backupDir)
    // Its own inode set, so hard links between snapshots count once; and,
    // from the same walk, how much of it is the live storage's own files (a
    // link, not a copy) rather than extra disk.
    const tree = await walk(backupRoot, budget, { keepFiles: true })
    let shared = 0
    const counted = new Set<string>()
    for (const f of tree.files_) {
      if (storageInodes.has(f.inode) && !counted.has(f.inode)) {
        counted.add(f.inode)
        shared += f.size
      }
    }
    let snapshots = 0
    try {
      snapshots = (await readdir(backupRoot, { withFileTypes: true })).filter(
        (e) => e.isDirectory() && (/^\d{8}-\d{6}$/.test(e.name) || e.name.startsWith("manual-")),
      ).length
    } catch {
      snapshots = 0
    }
    backups = { ...usage(tree), snapshots, sharedWithStorageBytes: shared }
  }

  const ollamaModels = deps.ollamaModelsDir ? usage(await walk(path.resolve(deps.ollamaModelsDir), budget)) : null

  return {
    generatedAt: new Date(now()).toISOString(),
    durationMs: now() - started,
    truncated: budget.exhausted,
    filesystem,
    database: {
      sizeBytes: databaseSize,
      storageObjects: { count: Number(objectTotals?.n ?? 0), bytes: Number(objectTotals?.bytes ?? 0) },
      byState: { active: state("active"), archived: state("archived"), failed: state("failed"), trash: state("trash") },
      orphanCandidates: state("orphan"),
      recentUnreferenced: state("recent"),
      missingFiles,
      elsewhere,
    },
    physical: {
      objects: {
        ...usage(objects),
        orphanCandidates: { count: physicalOrphans.length, bytes: physicalOrphans.reduce((s, f) => s + f.size, 0) },
      },
      thumbnails: usage(thumbnails),
      temp: usage(temp),
      resumablePartials: { ...usage(resumable), withActiveUpload, stale: resumable.files - withActiveUpload },
      storageLogs: usage(storageLogs),
      appLogs,
      other: usage(other),
    },
    backups,
    ollamaModels,
  }
}

/** The backup script's own default, used only when it exists on this machine. */
const BACKUP_SCRIPT_DEFAULT = "/srv/arce-projects/arciin-backups"
const OLLAMA_DEFAULT_MODELS = "/usr/share/ollama/.ollama/models"

/** The directories an audit looks at, all from server configuration. */
export function storageAuditRoots(storageRoot: string, env: NodeJS.ProcessEnv = process.env) {
  const backupDir = env.ARCIIN_BACKUP_DIR || (existsSync(BACKUP_SCRIPT_DEFAULT) ? BACKUP_SCRIPT_DEFAULT : null)
  const appLogDir = path.resolve(process.cwd(), "logs")
  const ollama = env.OLLAMA_MODELS || OLLAMA_DEFAULT_MODELS
  return {
    storageRoot,
    backupDir,
    appLogDir: existsSync(appLogDir) ? appLogDir : null,
    ollamaModelsDir: existsSync(ollama) ? ollama : null,
  }
}

