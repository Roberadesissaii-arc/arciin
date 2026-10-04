import { fetchApi } from "@/lib/api/client"
import type { MediaType } from "@/lib/types/models"

export type UniversalFileResult = {
  id: string
  title: string | null
  originalFilename: string
  mediaType: MediaType
  mimeType: string
  extension: string | null
  durationSeconds: number | null
  coverImageAt: string | null
  updatedAt: string
  /** Where the file is browsed. Null only for a backup file with no media library. */
  library: { id: string | null; name: string; slug: string; kind: string } | null
  folder: { id: string; name: string; slug: string } | null
  /** `label` is "Matched by meaning" / "Related by meaning" for semantic hits — never a score. */
  match: { kind: "exact" | "literal" | "semantic"; label: string | null }
}

export type UniversalFolderResult = {
  id: string
  name: string
  slug: string
  /** Library-relative path, e.g. "/movies/2026". */
  path: string
  isLocked: boolean
  assetCount: number
  library: { id: string; name: string; slug: string; kind: string }
}

export type UniversalLibraryResult = { id: string; name: string; slug: string; kind: string }

export type UniversalSearchQuick = {
  query: string
  files: UniversalFileResult[]
  folders: UniversalFolderResult[]
  libraries: UniversalLibraryResult[]
}

export type SemanticAvailability = "used" | "disabled" | "unavailable" | "not_indexed"

export type UniversalSearchFiles = {
  query: string
  files: UniversalFileResult[]
  semantic: SemanticAvailability
  /** Present only while the semantic index is still building. */
  index: { indexed: number; eligible: number } | null
}

/** Keyword files, folders and libraries — fast, never waits on a model. */
export function universalSearch(q: string, signal?: AbortSignal) {
  return fetchApi<UniversalSearchQuick>(`/search?q=${encodeURIComponent(q)}`, { signal })
}

/** The same file search with matches by meaning added (hybrid). */
export function universalSearchFiles(q: string, signal?: AbortSignal) {
  return fetchApi<UniversalSearchFiles>(`/search/files?q=${encodeURIComponent(q)}`, { signal })
}
