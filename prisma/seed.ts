import { PrismaClient, IntegrationType } from "@prisma/client"

import { DEFAULT_LIBRARY_DEFINITIONS } from "@arciin/shared"

const prisma = new PrismaClient()

async function main() {
  const instance = await prisma.instanceConfig.findFirst()
  const defaultStorage = await prisma.storageLocation.findFirst({
    where: {
      isDefault: true,
    },
  })

  if (instance && defaultStorage) {
    for (const library of DEFAULT_LIBRARY_DEFINITIONS) {
      await prisma.library.upsert({
        where: {
          slug: library.slug,
        },
        update: {},
        create: {
          name: library.name,
          slug: library.slug,
          kind: library.kind,
          icon: library.icon,
          storageLocationId: defaultStorage.id,
        },
      })
    }
  }

  await prisma.integration.upsert({
    where: {
      id: "plex-placeholder",
    },
    update: {},
    create: {
      id: "plex-placeholder",
      name: "Plex",
      type: IntegrationType.PLEX,
      enabled: false,
      config: {
        status: "not_connected",
        plexFolderName: "Plex",
        librarySlugs: ["videos", "images", "music"],
        foldersReady: false,
      },
    },
  })

  await prisma.integration.upsert({
    where: { id: "jellyfin-connector" },
    update: {},
    create: {
      id: "jellyfin-connector",
      name: "Jellyfin",
      type: IntegrationType.CUSTOM,
      enabled: false,
      config: {
        status: "not_connected",
        connectorKind: "jellyfin",
        librarySlugs: ["videos", "images", "music"],
        foldersReady: false,
      },
    },
  })
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
