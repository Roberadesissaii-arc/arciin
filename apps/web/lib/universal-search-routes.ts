import type { UniversalFileResult, UniversalFolderResult } from "@/lib/api/search"

/**
 * Where a search result opens. Libraries with their own page get it; a
 * folder opens on its folder page where the library has one; a file opens on
 * the page that lists it, with `?asset=` asking that page to open the
 * inspector on it.
 */

export const LIBRARY_PAGE_ROUTES: Record<string, string> = {
  inbox: "/inbox",
  videos: "/videos",
  images: "/images",
  music: "/music",
  documents: "/documents",
}

/** Libraries whose page has a `/[folder]` child route. */
const FOLDER_PAGE_LIBRARIES = new Set(["videos", "images", "music", "documents"])

export function libraryHref(slug: string | null | undefined): string {
  return (slug && LIBRARY_PAGE_ROUTES[slug]) || "/files"
}

export function folderHref(folder: Pick<UniversalFolderResult, "slug"> & { library: { slug: string } }): string {
  const base = libraryHref(folder.library.slug)
  return FOLDER_PAGE_LIBRARIES.has(folder.library.slug) ? `${base}/${encodeURIComponent(folder.slug)}` : base
}

export function fileHref(file: Pick<UniversalFileResult, "id" | "library" | "folder">): string {
  const slug = file.library?.slug
  const base =
    file.folder && slug && FOLDER_PAGE_LIBRARIES.has(slug)
      ? `${libraryHref(slug)}/${encodeURIComponent(file.folder.slug)}`
      : libraryHref(slug)
  return `${base}?asset=${encodeURIComponent(file.id)}`
}

/** "Reveal in folder": the containing folder, or the library page. */
export function fileContainerHref(file: Pick<UniversalFileResult, "library" | "folder">): string {
  const slug = file.library?.slug
  if (file.folder && slug && FOLDER_PAGE_LIBRARIES.has(slug)) {
    return `${libraryHref(slug)}/${encodeURIComponent(file.folder.slug)}`
  }
  return libraryHref(slug)
}

export function allFilesSearchHref(query: string): string {
  return `/files?q=${encodeURIComponent(query)}`
}

export function fileDisplayTitle(file: Pick<UniversalFileResult, "title" | "originalFilename">): string {
  return file.title?.trim() || file.originalFilename
}

const TYPE_LABEL: Record<string, string> = {
  VIDEO: "Video",
  IMAGE: "Image",
  AUDIO: "Audio",
  DOCUMENT: "Document",
  ARCHIVE: "Archive",
  APPLICATION: "App",
  CODE: "Code",
  OTHER: "File",
}

/** "Images · Family" — type when no library, library and folder otherwise. */
export function fileContextLine(file: Pick<UniversalFileResult, "mediaType" | "extension" | "library" | "folder">): string {
  const ext = file.extension ? file.extension.toUpperCase() : TYPE_LABEL[file.mediaType] ?? "File"
  return [ext, file.library?.name, file.folder?.name].filter(Boolean).join(" · ")
}

/** Media whose server thumbnail is worth asking for. */
export function fileHasThumbnail(file: Pick<UniversalFileResult, "mediaType" | "coverImageAt">): boolean {
  return file.mediaType === "IMAGE" || file.mediaType === "VIDEO" || Boolean(file.coverImageAt)
}

export function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return null
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`
}
