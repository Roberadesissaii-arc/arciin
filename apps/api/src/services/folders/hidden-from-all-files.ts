import type { PrismaClient } from "@prisma/client"

/**
 * Folder ids that should be excluded from All Files / overview:
 * every folder with hideFromAllFiles, plus descendants under their pathCache.
 */
export async function resolveHiddenFromAllFilesFolderIds(
  prisma: PrismaClient,
): Promise<string[]> {
  const roots = await prisma.folder.findMany({
    where: { hideFromAllFiles: true, deletedAt: null },
    select: { id: true, libraryId: true, pathCache: true },
  })

  if (roots.length === 0) return []

  const descendants = await prisma.folder.findMany({
    where: {
      deletedAt: null,
      OR: roots.map((root) => ({
        libraryId: root.libraryId,
        pathCache: { startsWith: `${root.pathCache}/` },
      })),
    },
    select: { id: true },
  })

  return [...new Set([...roots.map((r) => r.id), ...descendants.map((d) => d.id)])]
}

/** Set hideFromAllFiles on a folder and every nested folder under it. */
export async function setFolderHideFromAllFilesCascade(
  prisma: PrismaClient,
  folder: { id: string; libraryId: string; pathCache: string },
  hideFromAllFiles: boolean,
) {
  await prisma.folder.updateMany({
    where: {
      libraryId: folder.libraryId,
      deletedAt: null,
      OR: [
        { id: folder.id },
        { pathCache: { startsWith: `${folder.pathCache}/` } },
      ],
    },
    data: { hideFromAllFiles },
  })

  return prisma.folder.findUniqueOrThrow({ where: { id: folder.id } })
}
