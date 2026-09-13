import type { LibraryKind, PrismaClient } from "@prisma/client"

import type { AssetScope } from "@/services/libraries/visible-asset-query"

export function mediaTypeForLibraryKind(
  kind: LibraryKind,
): "VIDEO" | "IMAGE" | "AUDIO" | "DOCUMENT" | null {
  if (kind === "VIDEO" || kind === "IMAGE" || kind === "AUDIO" || kind === "DOCUMENT") {
    return kind
  }
  return null
}

export async function computerLibraryIds(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.library.findMany({
    where: { kind: "COMPUTER" },
    select: { id: true },
  })
  return rows.map((row) => row.id)
}

export async function resolveSmartLibraryScope(
  prisma: PrismaClient,
  query: { libraryId?: string; folderId?: string; rootOnly?: boolean },
): Promise<AssetScope> {
  if (query.folderId) {
    return { kind: "folder", folderId: query.folderId }
  }
  if (!query.libraryId) {
    return { kind: "all" }
  }
  const library = await prisma.library.findUnique({
    where: { id: query.libraryId },
    select: { id: true, kind: true },
  })
  const mediaType = library ? mediaTypeForLibraryKind(library.kind) : null
  if (library && mediaType) {
    const computers = await computerLibraryIds(prisma)
    if (computers.length > 0) {
      return {
        kind: "libraryView",
        libraryId: library.id,
        mediaType,
        computerLibraryIds: computers,
        rootOnly: Boolean(query.rootOnly),
      }
    }
  }
  if (query.rootOnly) {
    return { kind: "libraryRoot", libraryId: query.libraryId }
  }
  return { kind: "library", libraryId: query.libraryId }
}

export function computerOwnerRestriction(user: { id: string; role: string }) {
  if (user.role === "OWNER" || user.role === "ADMIN") return null
  return user.id
}
