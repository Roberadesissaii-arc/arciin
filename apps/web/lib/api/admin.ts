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

export function getAdminTableData(
  table: string,
  page = 1,
  signal?: AbortSignal,
  filters: { status?: ApiKeyStatusFilter } = {},
) {
  const status = filters.status && filters.status !== "all" ? `&status=${filters.status}` : ""
  return fetchApi<AdminTableData>(`/admin/tables/${table}?page=${page}&limit=20${status}`, {
    method: "GET",
    signal,
  })
}
