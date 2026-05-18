import type { UploadContext } from "@/lib/stores/upload-store"
import type { LibraryKind } from "@/lib/types/models"
import { classifyMediaType, mediaTypeToLibraryKind } from "@/lib/utils/media-type"

export type ResolvedUploadTarget = {
  targetLibraryId?: string
  targetFolderId?: string
}

function fileMatchesLibraryKind(file: File, libraryKind: LibraryKind) {
  if (libraryKind === "INBOX" || libraryKind === "CUSTOM") {
    return true
  }
  const fileKind = mediaTypeToLibraryKind(classifyMediaType(file.type, file.name))
  return fileKind === libraryKind
}

/** Map a dropped file + current page context to upload query params. */
export function resolveUploadTargetForFile(
  file: File,
  context: UploadContext | null | undefined
): ResolvedUploadTarget {
  if (!context?.libraryId) {
    return {}
  }

  if (context.folderId) {
    return {
      targetLibraryId: context.libraryId,
      targetFolderId: context.folderId,
    }
  }

  if (context.libraryKind && !fileMatchesLibraryKind(file, context.libraryKind)) {
    return {}
  }

  return {
    targetLibraryId: context.libraryId,
  }
}
