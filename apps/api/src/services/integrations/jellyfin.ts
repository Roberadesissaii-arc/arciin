import type { PrismaClient } from "@prisma/client"

import {
  JELLYFIN_CONNECTOR_DEF,
  JELLYFIN_INTEGRATION_ID,
  PLEX_CONNECTOR_DEF,
  clearAssetConnectorMirror,
  clearAssetMirrorIfLeavingConnectorFolders,
  ensureConnectorFolders,
  findConnectorFolder,
  getConnectorStatus,
  isConnectorEnabled,
  syncAssetToEnabledConnectorMirrors,
  assetIsInConnectorFolder,
  type ConnectorFolderStatus,
  type ConnectorStatus,
} from "@/services/integrations/library-media-connector"

export const JELLYFIN_FOLDER_NAME = "Jellyfin"

export type JellyfinFolderStatus = ConnectorFolderStatus
export type JellyfinStatus = ConnectorStatus

export { JELLYFIN_CONNECTOR_DEF, JELLYFIN_INTEGRATION_ID }

export async function isJellyfinIntegrationEnabled(prisma: PrismaClient) {
  return isConnectorEnabled(prisma, JELLYFIN_CONNECTOR_DEF)
}

export function findJellyfinFolder(prisma: PrismaClient, libraryId: string) {
  return findConnectorFolder(prisma, libraryId, JELLYFIN_FOLDER_NAME)
}

export const ensureJellyfinFolders = (prisma: PrismaClient) =>
  ensureConnectorFolders(prisma, JELLYFIN_CONNECTOR_DEF)

export const getJellyfinStatus = (prisma: PrismaClient) =>
  getConnectorStatus(prisma, JELLYFIN_CONNECTOR_DEF)

export function assetIsInJellyfinFolder(folder: Parameters<typeof assetIsInConnectorFolder>[0]) {
  return assetIsInConnectorFolder(folder, JELLYFIN_FOLDER_NAME)
}

export const syncAssetToJellyfinMirror = (prisma: PrismaClient, assetId: string) =>
  syncAssetToEnabledConnectorMirrors(prisma, assetId, PLEX_CONNECTOR_DEF, JELLYFIN_CONNECTOR_DEF)

export const clearAssetJellyfinMirror = (prisma: PrismaClient, assetId: string) =>
  clearAssetConnectorMirror(prisma, assetId)

export { clearAssetMirrorIfLeavingConnectorFolders }
