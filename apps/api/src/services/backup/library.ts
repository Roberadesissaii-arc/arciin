import { COMPUTERS_LIBRARY_DEFINITION } from "@arciin/config"
import type { Library, Prisma, PrismaClient } from "@prisma/client"

import { slugify } from "@/services/slug"

import { BackupError } from "./errors"

export async function ensureComputersLibrary(
  prisma: PrismaClient | Prisma.TransactionClient,
): Promise<Library> {
  const existing = await prisma.library.findUnique({
    where: { slug: COMPUTERS_LIBRARY_DEFINITION.slug },
  })
  if (existing) return existing

  const storage = await prisma.storageLocation.findFirst({
    where: { isDefault: true },
    orderBy: { createdAt: "asc" },
  })
  if (!storage) {
    throw new BackupError(
      "BACKUP_NOT_SUPPORTED",
      "Storage is not configured, so computer backup cannot start.",
      503,
    )
  }

  try {
    return await prisma.library.create({
      data: {
        name: COMPUTERS_LIBRARY_DEFINITION.name,
        slug: COMPUTERS_LIBRARY_DEFINITION.slug,
        kind: "COMPUTER",
        icon: COMPUTERS_LIBRARY_DEFINITION.icon,
        storageLocationId: storage.id,
      },
    })
  } catch {
    const raced = await prisma.library.findUnique({
      where: { slug: COMPUTERS_LIBRARY_DEFINITION.slug },
    })
    if (raced) return raced
    throw new BackupError("BACKUP_NOT_SUPPORTED", "Could not create the Computers library.", 503)
  }
}

export async function ensureDeviceFolder(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: { deviceId: string; deviceName: string; libraryId: string },
) {
  const slug = `device-${input.deviceId}`
  const existing = await prisma.folder.findFirst({
    where: { libraryId: input.libraryId, pathCache: slug, deletedAt: null },
  })
  if (existing) {
    if (existing.name !== input.deviceName) {
      return prisma.folder.update({
        where: { id: existing.id },
        data: { name: input.deviceName },
      })
    }
    return existing
  }

  return prisma.folder.create({
    data: {
      libraryId: input.libraryId,
      parentFolderId: null,
      name: input.deviceName,
      slug: slugify(slug),
      pathCache: slug,
    },
  })
}

export function folderSlugForSegment(name: string, fallback: string): string {
  const slug = slugify(name)
  return slug || fallback
}
