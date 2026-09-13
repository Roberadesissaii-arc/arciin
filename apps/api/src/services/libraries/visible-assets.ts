import type { PrismaClient } from "@prisma/client"

import { resolveHiddenFromAllFilesFolderIds } from "@/services/folders/hidden-from-all-files"
import {
  computerLibraryIds,
  computerOwnerRestriction,
  mediaTypeForLibraryKind,
  resolveSmartLibraryScope,
} from "@/services/libraries/library-view"
import { buildVisibleAssetWhere } from "@/services/libraries/visible-asset-query"

export * from "@/services/libraries/visible-asset-query"

/**
 * Visible asset totals per library, in one query, using the same rules as the
 * library listing.
 */
export async function countVisibleAssetsByLibrary(
  prisma: PrismaClient,
  viewer?: { id: string; role: string },
): Promise<Map<string, number>> {
  const hiddenFolderIds = await resolveHiddenFromAllFilesFolderIds(prisma)
  const libraries = await prisma.library.findMany({
    select: { id: true, kind: true },
  })
  const computers = await computerLibraryIds(prisma)
  const restrictComputerOwnerId = viewer ? computerOwnerRestriction(viewer) : null
  const map = new Map<string, number>()

  await Promise.all(
    libraries.map(async (library) => {
      if (library.kind === "COMPUTER") return
      const mediaType = mediaTypeForLibraryKind(library.kind)
      const scope =
        mediaType && computers.length > 0
          ? {
              kind: "libraryView" as const,
              libraryId: library.id,
              mediaType,
              computerLibraryIds: computers,
            }
          : { kind: "library" as const, libraryId: library.id }
      const count = await prisma.asset.count({
        where: buildVisibleAssetWhere({
          scope,
          hiddenFolderIds,
          computerLibraryIds: computers,
          restrictComputerOwnerId,
        }),
      })
      map.set(library.id, count)
    }),
  )

  return map
}

/** Visible asset total for a single library. */
export async function countVisibleAssetsForLibrary(
  prisma: PrismaClient,
  libraryId: string,
  viewer?: { id: string; role: string },
): Promise<number> {
  const hiddenFolderIds = await resolveHiddenFromAllFilesFolderIds(prisma)
  const scope = await resolveSmartLibraryScope(prisma, { libraryId })
  const computers = await computerLibraryIds(prisma)

  return prisma.asset.count({
    where: buildVisibleAssetWhere({
      scope,
      hiddenFolderIds,
      computerLibraryIds: computers,
      restrictComputerOwnerId: viewer ? computerOwnerRestriction(viewer) : null,
    }),
  })
}
