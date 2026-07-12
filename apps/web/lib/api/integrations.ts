import { fetchApi } from "@/lib/api/client"
import type { IntegrationSummary } from "@/lib/types/models"

export type PlexFolderStatus = {
  libraryId: string
  librarySlug: string
  libraryName: string
  folderId: string | null
  folderPath: string
  ready: boolean
}

export type ConnectorStatus = {
  enabled: boolean
  folders: PlexFolderStatus[]
  storageRoot: string
  mirrorRootHint: string
}

export type PlexStatus = ConnectorStatus
export type JellyfinStatus = ConnectorStatus

export function getPlexIntegration(signal?: AbortSignal) {
  return fetchApi<IntegrationSummary>("/integrations/plex", { method: "GET", signal })
}

export function getPlexStatus(signal?: AbortSignal) {
  return fetchApi<PlexStatus>("/integrations/plex/status", { method: "GET", signal })
}

export function updatePlexIntegration(input: { enabled?: boolean }) {
  return fetchApi<IntegrationSummary>("/integrations/plex", {
    method: "PATCH",
    body: input,
  })
}

export function setupPlexFolders() {
  return fetchApi<{ created: number; folders: PlexFolderStatus[] }>(
    "/integrations/plex/setup-folders",
    { method: "POST", body: {} },
  )
}

export const PLEX_INTEGRATION_ID = "plex-placeholder"
export const JELLYFIN_INTEGRATION_ID = "jellyfin-connector"

const FALLBACK_TIMESTAMP = "1970-01-01T00:00:00.000Z"

/** UI fallback when list has not loaded yet; API upserts real rows on GET /integrations. */
export const DEFAULT_PLEX_INTEGRATION: IntegrationSummary = {
  id: PLEX_INTEGRATION_ID,
  type: "PLEX",
  name: "Plex",
  enabled: false,
  config: { status: "not_connected" },
  createdAt: FALLBACK_TIMESTAMP,
  updatedAt: FALLBACK_TIMESTAMP,
}

export const DEFAULT_JELLYFIN_INTEGRATION: IntegrationSummary = {
  id: JELLYFIN_INTEGRATION_ID,
  type: "CUSTOM",
  name: "Jellyfin",
  enabled: false,
  config: { status: "not_connected", connectorKind: "jellyfin" },
  createdAt: FALLBACK_TIMESTAMP,
  updatedAt: FALLBACK_TIMESTAMP,
}

export function getJellyfinIntegration(signal?: AbortSignal) {
  return fetchApi<IntegrationSummary>("/integrations/jellyfin", { method: "GET", signal })
}

export function getJellyfinStatus(signal?: AbortSignal) {
  return fetchApi<JellyfinStatus>("/integrations/jellyfin/status", { method: "GET", signal })
}

export function updateJellyfinIntegration(input: { enabled?: boolean }) {
  return fetchApi<IntegrationSummary>("/integrations/jellyfin", {
    method: "PATCH",
    body: input,
  })
}

export function setupJellyfinFolders() {
  return fetchApi<{ created: number; folders: PlexFolderStatus[] }>(
    "/integrations/jellyfin/setup-folders",
    { method: "POST", body: {} },
  )
}
