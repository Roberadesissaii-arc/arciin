import { fetchApi } from "@/lib/api/client"
import type { LogFileSummary, LogsOverview } from "@/lib/types/models"

export function getLogsOverview(signal?: AbortSignal) {
  return fetchApi<LogsOverview>("/logs/overview", { method: "GET", signal })
}

export function getLogFiles(signal?: AbortSignal) {
  return fetchApi<LogFileSummary[]>("/logs/files", { method: "GET", signal })
}

export function getLogTail(filename: string, lines = 200, signal?: AbortSignal) {
  const params = new URLSearchParams({ lines: String(lines) })
  return fetchApi<{ filename: string; lines: string[] }>(
    `/logs/files/${encodeURIComponent(filename)}/tail?${params.toString()}`,
    { method: "GET", signal },
  )
}
