import { createFolder, getFolders } from "@/lib/api/libraries"
import type { FolderSummary, LibrarySummary } from "@/lib/types/models"
import { classifyMediaType, mediaTypeToLibraryKind } from "@/lib/utils/media-type"

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "")
}

function directorySegments(relativePath: string): string[] {
  const parts = normalizePath(relativePath).split("/").filter(Boolean)
  if (parts.length <= 1) return []
  return parts.slice(0, -1)
}

function libraryForFile(
  file: File,
  libraries: LibrarySummary[],
  contextLibraryId?: string,
): LibrarySummary | undefined {
  if (contextLibraryId) {
    return libraries.find((l) => l.id === contextLibraryId)
  }
  const mediaType = classifyMediaType(file.type, file.name)
  const kind = mediaTypeToLibraryKind(mediaType)
  return (
    libraries.find((l) => l.kind === kind) ??
    libraries.find((l) => l.slug === "inbox") ??
    libraries[0]
  )
}

export type PreparedUploadTarget = {
  file: File
  targetLibraryId?: string
  targetFolderId?: string
}

/**
 * Resolve per-file library + nested folder ids from webkitRelativePath
 * (e.g. Gemini/images/photo.jpg → Images → folders Gemini → images).
 */
export async function prepareUploadTargets(
  files: File[],
  options: {
    libraries: LibrarySummary[]
    contextLibraryId?: string
    contextFolderId?: string | null
  },
): Promise<PreparedUploadTarget[]> {
  const { libraries, contextLibraryId, contextFolderId } = options
  const foldersByLibrary = new Map<string, FolderSummary[]>()
  const folderIdCache = new Map<string, string>()

  async function loadFolders(libraryId: string): Promise<FolderSummary[]> {
    const cached = foldersByLibrary.get(libraryId)
    if (cached) return cached
    const list = await getFolders(libraryId)
    foldersByLibrary.set(libraryId, list)
    return list
  }

  async function ensurePath(
    libraryId: string,
    segments: string[],
    parentFolderId: string | null | undefined,
  ): Promise<string | undefined> {
    if (segments.length === 0) return parentFolderId ?? undefined

    let parentId = parentFolderId ?? null
    const folders = await loadFolders(libraryId)

    for (let i = 0; i < segments.length; i++) {
      const name = segments[i]!
      const pathCache = segments.slice(0, i + 1).join("/")
      const cacheKey = `${libraryId}:${pathCache}`
      const cachedId = folderIdCache.get(cacheKey)
      if (cachedId) {
        parentId = cachedId
        continue
      }

      const existing = folders.find(
        (f) =>
          f.pathCache === pathCache &&
          (parentId ? f.parentFolderId === parentId : !f.parentFolderId),
      )
      if (existing) {
        folderIdCache.set(cacheKey, existing.id)
        parentId = existing.id
        continue
      }

      const created = await createFolder({
        libraryId,
        name,
        parentFolderId: parentId,
      })
      folders.push(created)
      folderIdCache.set(cacheKey, created.id)
      parentId = created.id
    }

    return parentId ?? undefined
  }

  const prepared: PreparedUploadTarget[] = []

  for (const file of files) {
    const rel =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    const segments = directorySegments(rel)
    const library = libraryForFile(file, libraries, contextLibraryId)

    if (!library) {
      prepared.push({ file })
      continue
    }

    let targetFolderId = contextFolderId ?? undefined

    if (segments.length > 0) {
      try {
        targetFolderId = await ensurePath(
          library.id,
          segments,
          contextFolderId ?? null,
        )
      } catch {
        // fall back to library root / context folder
      }
    }

    prepared.push({
      file,
      targetLibraryId: library.id,
      targetFolderId,
    })
  }

  return prepared
}

export function countFolderUploadRoots(files: File[]): number {
  const roots = new Set<string>()
  for (const file of files) {
    const rel =
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || ""
    const norm = normalizePath(rel)
    const parts = norm.split("/").filter(Boolean)
    if (parts.length > 1) roots.add(parts[0]!)
  }
  return roots.size
}
