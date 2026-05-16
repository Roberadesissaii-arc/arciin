import type { PrismaClient } from "@prisma/client"
import { IntegrationType } from "@prisma/client"

import { JELLYFIN_INTEGRATION_ID } from "@/services/integrations/library-media-connector"

export const PLEX_INTEGRATION_ID = "plex-placeholder"

const DEFAULT_LIBRARY_SLUGS = ["videos", "images", "music"] as const

/** Ensures Plex and Jellyfin connector rows exist (existing instances may predate Jellyfin). */
export async function ensureDefaultMediaIntegrations(prisma: PrismaClient) {
  await prisma.integration.upsert({
    where: { id: PLEX_INTEGRATION_ID },
    update: {},
    create: {
      id: PLEX_INTEGRATION_ID,
      name: "Plex",
      type: IntegrationType.PLEX,
      enabled: false,
      config: {
        status: "not_connected",
        plexFolderName: "Plex",
        librarySlugs: [...DEFAULT_LIBRARY_SLUGS],
        foldersReady: false,
      },
    },
  })

  await prisma.integration.upsert({
    where: { id: JELLYFIN_INTEGRATION_ID },
    update: {},
    create: {
      id: JELLYFIN_INTEGRATION_ID,
      name: "Jellyfin",
      type: IntegrationType.CUSTOM,
      enabled: false,
      config: {
        status: "not_connected",
        connectorKind: "jellyfin",
        librarySlugs: [...DEFAULT_LIBRARY_SLUGS],
        foldersReady: false,
      },
    },
  })
}
