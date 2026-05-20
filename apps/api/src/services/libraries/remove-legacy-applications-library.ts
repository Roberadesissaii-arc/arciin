import type { PrismaClient } from "@prisma/client"

/**
 * Removes the deprecated "applications" library (Docker seed used to create it).
 * Installer assets are moved to Inbox; the library row is deleted.
 */
export async function removeLegacyApplicationsLibrary(
  prisma: PrismaClient,
): Promise<boolean> {
  const applications = await prisma.library.findFirst({
    where: { slug: "applications" },
  })
  if (!applications) return false

  const inbox =
    (await prisma.library.findFirst({ where: { slug: "inbox" } })) ??
    (await prisma.library.findFirst({ where: { kind: "INBOX" } }))

  if (inbox) {
    await prisma.asset.updateMany({
      where: { libraryId: applications.id },
      data: { libraryId: inbox.id, folderId: null },
    })
    await prisma.folder.deleteMany({
      where: { libraryId: applications.id },
    })
  } else {
    const activeAssets = await prisma.asset.count({
      where: { libraryId: applications.id, deletedAt: null },
    })
    if (activeAssets > 0) return false
    await prisma.folder.deleteMany({
      where: { libraryId: applications.id },
    })
  }

  await prisma.library.delete({
    where: { id: applications.id },
  })
  return true
}
