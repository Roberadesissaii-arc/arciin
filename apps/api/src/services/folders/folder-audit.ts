import type { Prisma, PrismaClient } from "@prisma/client"

/**
 * What the Folder table actually holds, told truthfully.
 *
 * Computer Backup was removed as a product, but its Folder, Asset and
 * StorageObject rows were deliberately kept. On a machine that once backed up
 * a development laptop that is thousands of folders (`__pycache__`, project
 * trees) that no library shows — and "Folders — 3,599" beside a sidebar with a
 * handful of folders reads like corruption. It is history.
 *
 * The classification comes from relational data only: a folder is legacy when
 * its library is the COMPUTER library, deleted when `deletedAt` is set (which
 * wins), and current otherwise. Name patterns are reported as diagnostics and
 * never decide anything. Nothing here writes.
 */

export const FOLDER_CLASS_FILTERS = ["all", "current", "legacy", "deleted"] as const
export type FolderClassFilter = (typeof FOLDER_CLASS_FILTERS)[number]
export type FolderClass = "current" | "legacy" | "deleted"

export async function legacyComputerLibraryIds(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.library.findMany({ where: { kind: "COMPUTER" }, select: { id: true } })
  return rows.map((row) => row.id)
}

export function classifyFolder(folder: { deletedAt: Date | null; libraryId: string }, legacyIds: ReadonlySet<string>): FolderClass {
  if (folder.deletedAt) return "deleted"
  return legacyIds.has(folder.libraryId) ? "legacy" : "current"
}

/** The same rule as classifyFolder, as a where clause, so paging and totals stay honest. */
export function folderClassWhere(filter: FolderClassFilter, legacyIds: string[]): Prisma.FolderWhereInput {
  switch (filter) {
    case "deleted":
      return { deletedAt: { not: null } }
    case "legacy":
      return { deletedAt: null, libraryId: { in: legacyIds } }
    case "current":
      return { deletedAt: null, libraryId: { notIn: legacyIds } }
    default:
      return {}
  }
}

/** Folder names that mark a copied development tree. Diagnostic only. */
const DEV_TREE_NAMES = ["__pycache__", "node_modules", ".git", ".venv", "venv", ".next", "dist", "build", ".cache", "target"]

export type FolderAudit = {
  total: number
  live: number
  deleted: number
  current: number
  legacyComputer: number
  legacyWithAssets: number
  legacyWithoutAssets: number
  legacyDeleted: number
  legacyAssets: number
  legacyAssetsInTrash: number
  currentWithAssets: number
  assetsInCurrentFolders: number
  maxDepth: { current: number; legacy: number }
  legacyRoots: { count: number; largest: Array<{ name: string; folders: number; assets: number }> }
  perLibrary: Array<{ name: string; kind: string; current: number; legacy: number; deleted: number }>
  /** Legacy folders whose own name marks a copied development tree. Not used to classify. */
  diagnostics: { devTreeFolderNames: Array<{ name: string; folders: number }> }
}

const n = (value: unknown) => Number(value ?? 0)

export async function auditFolders(prisma: PrismaClient): Promise<FolderAudit> {
  const legacy = await legacyComputerLibraryIds(prisma)
  // A never-matching id keeps `= ANY` valid when there is no COMPUTER library.
  const legacyIds = legacy.length ? legacy : ["-"]

  const [counts] = await prisma.$queryRaw<Array<Record<string, bigint | number>>>`
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE f."deletedAt" IS NOT NULL) AS deleted,
      count(*) FILTER (WHERE f."deletedAt" IS NULL AND NOT (f."libraryId" = ANY(${legacyIds}))) AS current,
      count(*) FILTER (WHERE f."deletedAt" IS NULL AND f."libraryId" = ANY(${legacyIds})) AS legacy,
      count(*) FILTER (WHERE f."deletedAt" IS NOT NULL AND f."libraryId" = ANY(${legacyIds})) AS "legacyDeleted",
      count(*) FILTER (WHERE f."deletedAt" IS NULL AND f."libraryId" = ANY(${legacyIds})
        AND EXISTS (SELECT 1 FROM "Asset" a WHERE a."folderId" = f.id AND a."deletedAt" IS NULL)) AS "legacyWithAssets",
      count(*) FILTER (WHERE f."deletedAt" IS NULL AND NOT (f."libraryId" = ANY(${legacyIds}))
        AND EXISTS (SELECT 1 FROM "Asset" a WHERE a."folderId" = f.id AND a."deletedAt" IS NULL)) AS "currentWithAssets",
      coalesce(max(array_length(string_to_array(trim(both '/' from f."pathCache"), '/'), 1))
        FILTER (WHERE f."deletedAt" IS NULL AND NOT (f."libraryId" = ANY(${legacyIds}))), 0) AS "currentDepth",
      coalesce(max(array_length(string_to_array(trim(both '/' from f."pathCache"), '/'), 1))
        FILTER (WHERE f."deletedAt" IS NULL AND f."libraryId" = ANY(${legacyIds})), 0) AS "legacyDepth"
    FROM "Folder" f
  `

  const [assets] = await prisma.$queryRaw<Array<Record<string, bigint | number>>>`
    SELECT
      count(*) FILTER (WHERE a."libraryId" = ANY(${legacyIds}) AND a."deletedAt" IS NULL) AS "legacyAssets",
      count(*) FILTER (WHERE a."libraryId" = ANY(${legacyIds}) AND a."deletedAt" IS NOT NULL) AS "legacyAssetsInTrash",
      count(*) FILTER (WHERE a."deletedAt" IS NULL AND a."folderId" IS NOT NULL AND NOT (a."libraryId" = ANY(${legacyIds}))
        AND EXISTS (SELECT 1 FROM "Folder" f WHERE f.id = a."folderId" AND f."deletedAt" IS NULL)) AS "assetsInCurrentFolders"
    FROM "Asset" a
  `

  // Top-level legacy folders (one per backed-up device or root), largest first.
  // Descendants by exact path prefix, not LIKE: `_` in "__pycache__" is a
  // LIKE wildcard.
  const roots = await prisma.$queryRaw<Array<{ name: string; folders: bigint; assets: bigint }>>`
    SELECT r.name,
      (SELECT count(*) FROM "Folder" d WHERE d."libraryId" = r."libraryId" AND d."deletedAt" IS NULL
        AND (d.id = r.id OR left(d."pathCache", length(r."pathCache") + 1) = r."pathCache" || '/')) AS folders,
      (SELECT count(*) FROM "Asset" a JOIN "Folder" d ON d.id = a."folderId"
        WHERE a."deletedAt" IS NULL AND d."libraryId" = r."libraryId"
        AND (d.id = r.id OR left(d."pathCache", length(r."pathCache") + 1) = r."pathCache" || '/')) AS assets
    FROM "Folder" r
    WHERE r."libraryId" = ANY(${legacyIds}) AND r."deletedAt" IS NULL AND r."parentFolderId" IS NULL
    ORDER BY folders DESC, r.name
    LIMIT 10
  `
  const [rootCount] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM "Folder"
    WHERE "libraryId" = ANY(${legacyIds}) AND "deletedAt" IS NULL AND "parentFolderId" IS NULL
  `

  const perLibrary = await prisma.$queryRaw<Array<{ name: string; kind: string; current: bigint; legacy: bigint; deleted: bigint }>>`
    SELECT l.name, l.kind::text AS kind,
      count(f.id) FILTER (WHERE f."deletedAt" IS NULL AND l.kind <> 'COMPUTER') AS current,
      count(f.id) FILTER (WHERE f."deletedAt" IS NULL AND l.kind = 'COMPUTER') AS legacy,
      count(f.id) FILTER (WHERE f."deletedAt" IS NOT NULL) AS deleted
    FROM "Library" l
    LEFT JOIN "Folder" f ON f."libraryId" = l.id
    GROUP BY l.id, l.name, l.kind
    ORDER BY l.kind, l.name
  `

  const devTree = await prisma.$queryRaw<Array<{ name: string; folders: bigint }>>`
    SELECT f.name, count(*) AS folders
    FROM "Folder" f
    WHERE f."libraryId" = ANY(${legacyIds}) AND f."deletedAt" IS NULL AND f.name = ANY(${DEV_TREE_NAMES})
    GROUP BY f.name
    ORDER BY folders DESC
  `

  const legacyLive = n(counts?.legacy)
  const legacyWithAssets = n(counts?.legacyWithAssets)
  return {
    total: n(counts?.total),
    live: n(counts?.total) - n(counts?.deleted),
    deleted: n(counts?.deleted),
    current: n(counts?.current),
    legacyComputer: legacyLive,
    legacyWithAssets,
    legacyWithoutAssets: legacyLive - legacyWithAssets,
    legacyDeleted: n(counts?.legacyDeleted),
    legacyAssets: n(assets?.legacyAssets),
    legacyAssetsInTrash: n(assets?.legacyAssetsInTrash),
    currentWithAssets: n(counts?.currentWithAssets),
    assetsInCurrentFolders: n(assets?.assetsInCurrentFolders),
    maxDepth: { current: n(counts?.currentDepth), legacy: n(counts?.legacyDepth) },
    legacyRoots: {
      count: n(rootCount?.n),
      largest: roots.map((r) => ({ name: r.name, folders: n(r.folders), assets: n(r.assets) })),
    },
    perLibrary: perLibrary.map((l) => ({ name: l.name, kind: l.kind, current: n(l.current), legacy: n(l.legacy), deleted: n(l.deleted) })),
    diagnostics: { devTreeFolderNames: devTree.map((d) => ({ name: d.name, folders: n(d.folders) })) },
  }
}
