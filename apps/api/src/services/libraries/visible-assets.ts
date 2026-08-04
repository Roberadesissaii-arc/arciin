import type { PrismaClient } from "@prisma/client"

import { resolveHiddenFromAllFilesFolderIds } from "@/services/folders/hidden-from-all-files"
import { buildVisibleAssetWhere } from "@/services/libraries/visible-asset-query"

export * from "@/services/libraries/visible-asset-query"

/**
 * Visible asset totals per library, in one query, using the same rules as the
 * library listing.
 */
export async function countVisibleAssetsByLibrary(
  prisma: PrismaClient,
): Promise<Map<string, number>> {
  const hiddenFolderIds = await resolveHiddenFromAllFilesFolderIds(prisma)

  const grouped = await prisma.asset.groupBy({
    by: ["libraryId"],
    where: buildVisibleAssetWhere({ scope: { kind: "all" }, hiddenFolderIds }),
    _count: { _all: true },
  })

  return new Map(grouped.map((row) => [row.libraryId, row._count._all]))
}

/** Visible asset total for a single library. */
export async function countVisibleAssetsForLibrary(
  prisma: PrismaClient,
  libraryId: string,
): Promise<number> {
  const hiddenFolderIds = await resolveHiddenFromAllFilesFolderIds(prisma)

  return prisma.asset.count({
    where: buildVisibleAssetWhere({
      scope: { kind: "library", libraryId },
      hiddenFolderIds,
    }),
  })
}
