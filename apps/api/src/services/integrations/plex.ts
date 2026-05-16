import type { PrismaClient } from "@prisma/client"

import {
  PLEX_CONNECTOR_DEF,
  JELLYFIN_CONNECTOR_DEF,
  clearAssetConnectorMirror,
  clearAssetMirrorIfLeavingConnectorFolders,
  ensureConnectorFolders,
  findConnectorFolder,
  getConnectorStatus,
  isConnectorEnabled,
  resolveMediaConnectorUploadFolderId,
  syncAssetToEnabledConnectorMirrors,
  assetIsInConnectorFolder,
  type ConnectorFolderStatus,
  type ConnectorStatus,
} from "@/services/integrations/library-media-connector"

export const PLEX_FOLDER_NAME = "Plex"
export const PLEX_LIBRARY_SLUGS = ["videos", "images", "music"] as const

export type PlexFolderStatus = ConnectorFolderStatus
export type PlexStatus = ConnectorStatus

export { PLEX_CONNECTOR_DEF }

export async function isPlexIntegrationEnabled(prisma: PrismaClient) {
  return isConnectorEnabled(prisma, PLEX_CONNECTOR_DEF)
}

export function findPlexFolder(prisma: PrismaClient, libraryId: string) {
  return findConnectorFolder(prisma, libraryId, PLEX_FOLDER_NAME)
}

export async function resolveUploadFolderId(
  prisma: PrismaClient,
  libraryId: string,
  librarySlug: string,
  explicitFolderId: string | undefined,
) {
  return resolveMediaConnectorUploadFolderId(
    prisma,
    libraryId,
    librarySlug,
    explicitFolderId,
    PLEX_CONNECTOR_DEF,
    JELLYFIN_CONNECTOR_DEF,
  )
}

export const ensurePlexFolders = (prisma: PrismaClient) =>
  ensureConnectorFolders(prisma, PLEX_CONNECTOR_DEF)

export const getPlexStatus = (prisma: PrismaClient) => getConnectorStatus(prisma, PLEX_CONNECTOR_DEF)

export function assetIsInPlexFolder(folder: Parameters<typeof assetIsInConnectorFolder>[0]) {
  return assetIsInConnectorFolder(folder, PLEX_FOLDER_NAME)
}

export const syncAssetToPlexMirror = (prisma: PrismaClient, assetId: string) =>
  syncAssetToEnabledConnectorMirrors(prisma, assetId, PLEX_CONNECTOR_DEF, JELLYFIN_CONNECTOR_DEF)

export const clearAssetPlexMirror = (prisma: PrismaClient, assetId: string) =>
  clearAssetConnectorMirror(prisma, assetId)

export { clearAssetMirrorIfLeavingConnectorFolders }
