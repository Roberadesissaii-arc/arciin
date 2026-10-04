/**
 * Universal search — the pure core.
 *
 * The top search box answers from several places at once (files, folders,
 * libraries, navigation). Each source is bounded and ranked here, with no
 * I/O, so the API, the browser and the tests share one definition of
 * "best match first".
 *
 * Files reuse the hybrid ranking from semantic search: exact name or title,
 * then prefix, then contains, then matches by meaning. A meaning match never
 * outranks a file named exactly, but a page full of loose "contains" hits
 * must not crowd every meaning match out of an eight-row panel either, so a
 * few slots are kept for them.
 */

import { mergeHybrid, semanticMatchLabel } from "./semantic-search"

/** Bounded result counts per group. */
export const UNIVERSAL_SEARCH_LIMITS = {
  files: 8,
  folders: 5,
  libraries: 5,
  navigation: 6,
} as const

/** Keyword rows fetched before ranking: enough that an exact match is never cut by recency. */
export const UNIVERSAL_SEARCH_LITERAL_WINDOW = 40

/** Slots kept for matches by meaning when keyword hits alone would fill the panel. */
export const UNIVERSAL_SEARCH_SEMANTIC_RESERVE = 3

export const UNIVERSAL_SEARCH_MIN_QUERY = 1
export const UNIVERSAL_SEARCH_MAX_QUERY = 200

/** Trim, collapse whitespace and bound a raw query. Empty means "no search". */
export function normalizeUniversalQuery(raw: unknown): string {
  if (typeof raw !== "string") return ""
  return raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, UNIVERSAL_SEARCH_MAX_QUERY)
}

export type UniversalFileMatch = { kind: "exact" | "literal" | "semantic"; label: string | null }

/**
 * Keyword rows (any order) plus scored meaning hits → at most `limit` rows,
 * exact → prefix → contains → meaning, with up to
 * UNIVERSAL_SEARCH_SEMANTIC_RESERVE slots held for meaning hits.
 */
export function rankUniversalFiles<T extends { id: string; originalFilename: string; title?: string | null }>(
  query: string,
  literal: T[],
  semantic: Array<{ item: T; score: number }>,
  limit: number = UNIVERSAL_SEARCH_LIMITS.files,
): Array<{ item: T; match: UniversalFileMatch }> {
  const merged = mergeHybrid(query, literal, semantic)
  const literalRows = merged.filter((row) => row.match.kind !== "semantic")
  const semanticRows = merged.filter((row) => row.match.kind === "semantic")
  const semanticSlots = Math.min(semanticRows.length, UNIVERSAL_SEARCH_SEMANTIC_RESERVE, limit)
  const literalTake = Math.min(literalRows.length, Math.max(0, limit - semanticSlots))
  const semanticTake = Math.min(semanticRows.length, limit - literalTake)
  return [...literalRows.slice(0, literalTake), ...semanticRows.slice(0, semanticTake)].map(({ item, match }) => ({
    item,
    match: { kind: match.kind, label: semanticMatchLabel(match) },
  }))
}

function norm(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().normalize("NFKC").trim()
}

/**
 * 4 = folder name is the query, 3 = name starts with it, 2 = name contains it,
 * 1 = only its path (a parent's name) contains it, 0 = no match.
 */
export function folderMatchTier(query: string, folder: { name: string; pathCache?: string | null }): 0 | 1 | 2 | 3 | 4 {
  const q = norm(query)
  if (!q) return 0
  const name = norm(folder.name)
  if (name === q) return 4
  if (name.startsWith(q)) return 3
  if (name.includes(q)) return 2
  if (norm(folder.pathCache).replace(/[-_/]+/g, " ").includes(q) || norm(folder.pathCache).includes(q)) return 1
  return 0
}

/** Best folder matches first; within a tier, shallower paths, then name. */
export function rankUniversalFolders<T extends { name: string; pathCache?: string | null }>(
  query: string,
  folders: T[],
  limit: number = UNIVERSAL_SEARCH_LIMITS.folders,
): T[] {
  return folders
    .map((folder) => ({ folder, tier: folderMatchTier(query, folder), depth: (folder.pathCache ?? "").split("/").filter(Boolean).length }))
    .filter((row) => row.tier > 0)
    .sort((a, b) => b.tier - a.tier || a.depth - b.depth || a.folder.name.localeCompare(b.folder.name))
    .slice(0, limit)
    .map((row) => row.folder)
}

/**
 * Navigation and library entries are matched by title words and a few
 * aliases ("prefs" finds Settings), prefix before contains.
 */
export function navigationMatchScore(query: string, entry: { title: string; keywords?: readonly string[] }): number {
  const q = norm(query)
  if (!q) return 1
  const title = norm(entry.title)
  if (title === q) return 5
  if (title.startsWith(q)) return 4
  if (title.split(/\s+/).some((word) => word.startsWith(q))) return 3
  if (title.includes(q)) return 2
  if (entry.keywords?.some((k) => norm(k).startsWith(q))) return 1
  return 0
}

export function rankNavigation<T extends { title: string; keywords?: readonly string[] }>(
  query: string,
  entries: T[],
  limit: number = UNIVERSAL_SEARCH_LIMITS.navigation,
): T[] {
  return entries
    .map((entry, index) => ({ entry, index, score: navigationMatchScore(query, entry) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((row) => row.entry)
}
