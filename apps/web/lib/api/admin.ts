import { fetchApi } from "@/lib/api/client"

/** A count worth showing beside a table, with the tone its badge should take. */
export type AdminTableSummaryMetric = {
  label: string
  value: number
  tone: "neutral" | "success" | "warning" | "danger"
}

export type AdminTable = {
  name: string
  label: string
  description: string
  count: number
  /**
   * Computed from the rows on the server.
   *
   * A raw row count is not the same as how many of a thing currently work:
   * "API Keys — 10 records" sits beside a management page listing three, and
   * the difference is history, not a discrepancy. These metrics let the UI say
   * that instead of leaving the reader to guess.
   */
  summary?: AdminTableSummaryMetric[]
}

export type AdminTableData = {
  rows: Record<string, unknown>[]
  total: number
  page: number
  totalPages: number
  limit: number
}

export function getAdminTables(signal?: AbortSignal) {
  return fetchApi<AdminTable[]>("/admin/tables", { method: "GET", signal })
}

export const API_KEY_STATUS_FILTERS = ["all", "active", "revoked", "expired"] as const
export type ApiKeyStatusFilter = (typeof API_KEY_STATUS_FILTERS)[number]

/** Database → Folders: current folders, kept Computer Backup trees, and deleted rows. */
export const FOLDER_CLASS_FILTERS = ["all", "current", "legacy", "deleted"] as const
export type FolderClassFilter = (typeof FOLDER_CLASS_FILTERS)[number]

/** Which tables can be narrowed, and by what. The server applies the same lists. */
export const TABLE_STATUS_FILTERS: Record<string, readonly string[]> = {
  "api-keys": API_KEY_STATUS_FILTERS,
  folders: FOLDER_CLASS_FILTERS,
}

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
  diagnostics: { devTreeFolderNames: Array<{ name: string; folders: number }> }
}

export function getFolderAudit(signal?: AbortSignal) {
  return fetchApi<FolderAudit>("/admin/folders/audit", { method: "GET", signal })
}

export function getAdminTableData(
  table: string,
  page = 1,
  signal?: AbortSignal,
  filters: { status?: string } = {},
) {
  const status = filters.status && filters.status !== "all" ? `&status=${filters.status}` : ""
  return fetchApi<AdminTableData>(`/admin/tables/${table}?page=${page}&limit=20${status}`, {
    method: "GET",
    signal,
  })
}

type TreeUsage = {
  available: boolean
  files: number
  apparentBytes: number
  uniqueBytes: number
  symlinksSkipped: number
  unreadable: number
  truncated: boolean
}

/** The read-only storage audit. Counts and labels only — never a path. */
export type StorageAudit = {
  generatedAt: string
  durationMs: number
  truncated: boolean
  filesystem: { totalBytes: number; usedBytes: number; freeBytes: number } | null
  database: {
    sizeBytes: number | null
    storageObjects: { count: number; bytes: number }
    byState: Record<"active" | "archived" | "failed" | "trash", { count: number; bytes: number }>
    orphanCandidates: { count: number; bytes: number }
    recentUnreferenced: { count: number; bytes: number }
    missingFiles: number
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

export type StorageAuditRun = {
  id: string
  status: "running" | "done" | "failed"
  startedAt: string
  finishedAt: string | null
  result: StorageAudit | null
  error: string | null
}

export function startStorageAudit() {
  return fetchApi<StorageAuditRun>("/admin/storage-audit", { method: "POST" })
}

export function getLatestStorageAudit(signal?: AbortSignal) {
  return fetchApi<StorageAuditRun | null>("/admin/storage-audit/latest", { method: "GET", signal })
}
