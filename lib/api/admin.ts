import { fetchApi } from "@/lib/api/client"

export type AdminTable = {
  name: string
  label: string
  description: string
  count: number
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

export function getAdminTableData(table: string, page = 1, signal?: AbortSignal) {
  return fetchApi<AdminTableData>(`/admin/tables/${table}?page=${page}&limit=20`, { method: "GET", signal })
}
