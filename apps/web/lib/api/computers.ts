import { fetchApi } from "@/lib/api/client"
import type { AssetSummary, FolderSummary } from "@/lib/types/models"

export type ComputerRoot = {
  id: string
  kind: string
  displayName: string
  sourcePathIdentifier: string
  folderId: string
  status: string
  fileCount: number
  folderCount: number
  byteCount: number
  lastSyncAt: string | null
}

export type ComputerCard = {
  deviceId: string
  profileId: string
  name: string
  platform: "WINDOWS" | "MACOS" | "LINUX" | "IOS" | "ANDROID" | "OTHER"
  health: "UP_TO_DATE" | "SYNCING" | "PAUSED" | "OFFLINE" | "ERROR" | "DISABLED"
  lastSyncAt: string | null
  lastHeartbeatAt: string | null
  fileCount: number
  byteCount: number
  roots: ComputerRoot[]
}

export type ComputerBrowse = {
  computer: ComputerCard
  folder: FolderSummary
  folders: FolderSummary[]
  assets: AssetSummary[]
  readOnly: boolean
}

export function listComputers(signal?: AbortSignal) {
  return fetchApi<ComputerCard[]>("/computers", { method: "GET", signal })
}

export function getComputer(deviceId: string, signal?: AbortSignal) {
  return fetchApi<ComputerCard>(`/computers/${deviceId}`, { method: "GET", signal })
}

export function browseComputer(deviceId: string, folderId?: string, signal?: AbortSignal) {
  const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""
  return fetchApi<ComputerBrowse>(`/computers/${deviceId}/browse${query}`, {
    method: "GET",
    signal,
  })
}

export function disableComputerBackup(profileId: string) {
  return fetchApi<{ id: string; status: string }>(`/backup/profiles/${profileId}/disable`, {
    method: "POST",
  })
}
