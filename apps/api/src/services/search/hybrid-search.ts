import type { Prisma, PrismaClient } from "@prisma/client"

import { mergeHybrid, semanticMatchLabel, type SearchMatch } from "@arciin/shared"

import { SemanticSearchService, type SemanticAvailability } from "@/services/search/semantic-search"

/**
 * Keyword search, with meaning added — never replaced.
 *
 * The literal query runs exactly as before. Semantic candidates (ids only)
 * are then loaded through the *same* visible-asset `where` the listing used,
 * minus the text condition, so a vector hit can never surface an asset the
 * listing itself would hide: deleted, in a deleted or hidden folder,
 * archived, another user's computer backup, outside the library or folder
 * being searched, or of another media type or category.
 */

const services = new WeakMap<PrismaClient, SemanticSearchService>()

export function semanticSearchFor(prisma: PrismaClient): SemanticSearchService {
  let service = services.get(prisma)
  if (!service) services.set(prisma, (service = new SemanticSearchService(prisma)))
  return service
}

export type HybridRow<T> = T & { searchMatch?: { kind: SearchMatch["kind"]; label: string | null } }

export async function withSemanticMatches<T extends { id: string; originalFilename: string; title: string | null }>(input: {
  prisma: PrismaClient
  query: string
  literalRows: T[]
  /** The listing's own where, built without `search` and without a cursor. */
  visibleWhere: Prisma.AssetWhereInput
  /** Load full rows for the candidate ids, with whatever `include` the listing uses. */
  load: (where: Prisma.AssetWhereInput) => Promise<T[]>
  limit: number
  candidates?: Promise<{ status: SemanticAvailability; hits: Array<{ id: string; score: number }> }>
}): Promise<{ rows: Array<HybridRow<T>>; semantic: SemanticAvailability; added: number }> {
  const found = await (input.candidates ?? semanticSearchFor(input.prisma).candidates(input.query))
  const literalIds = new Set(input.literalRows.map((row) => row.id))
  const wanted = found.hits.filter((hit) => !literalIds.has(hit.id)).slice(0, Math.max(0, input.limit) * 2)
  let semanticRows: Array<{ item: T; score: number }> = []
  if (wanted.length > 0) {
    const allowed = await input.load({ AND: [input.visibleWhere, { id: { in: wanted.map((h) => h.id) } }] })
    const score = new Map(wanted.map((h) => [h.id, h.score]))
    semanticRows = allowed.map((item) => ({ item, score: score.get(item.id) ?? 0 })).slice(0, input.limit)
  }
  const merged = mergeHybrid(input.query, input.literalRows, semanticRows)
  return {
    rows: merged.map(({ item, match }) =>
      match.kind === "semantic" ? { ...item, searchMatch: { kind: match.kind, label: semanticMatchLabel(match) } } : item,
    ),
    semantic: found.status,
    added: semanticRows.length,
  }
}

/** Adds `searchMatch` (a label, never a score) to serialized items that were found by meaning. */
export function withSearchMatches<T extends { id: string }>(items: T[], matches: Map<string, unknown>): T[] {
  if (matches.size === 0) return items
  return items.map((item) => (matches.has(item.id) ? { ...item, searchMatch: matches.get(item.id) } : item))
}
