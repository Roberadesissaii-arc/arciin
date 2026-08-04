import type { Prisma } from "@prisma/client"

/**
 * Cursor pagination for asset listings.
 *
 * Keyset rather than offset: assets are ordered newest-first and new uploads
 * arrive constantly, so an OFFSET page would skip or repeat rows as the list
 * shifts under the reader. The cursor is the last row's `(createdAt, id)` pair.
 *
 * `createdAt` alone is not unique — a batch upload writes many rows in the same
 * millisecond — so `id` is carried as a deterministic tie-breaker and the
 * ordering is always `createdAt DESC, id DESC`.
 *
 * Pure module: no Prisma client, no `@/` imports, so the rules are unit-testable.
 */

export const ASSET_PAGE_SIZE_DEFAULT = 60
export const ASSET_PAGE_SIZE_MAX = 200

export type AssetCursor = {
  createdAt: Date
  id: string
}

/** Opaque to callers; base64 keeps it out of the way in query strings. */
export function encodeAssetCursor(cursor: AssetCursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`, "utf8").toString(
    "base64url",
  )
}

export function decodeAssetCursor(raw: string | undefined | null): AssetCursor | null {
  if (!raw) return null

  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8")
    // Split on the FIRST separator: an ISO timestamp never contains "|", but an
    // id conceivably could, so everything after the first one is the id.
    const separator = decoded.indexOf("|")
    if (separator <= 0) return null

    const createdAt = new Date(decoded.slice(0, separator))
    const id = decoded.slice(separator + 1)
    if (!id || Number.isNaN(createdAt.getTime())) return null

    return { createdAt, id }
  } catch {
    // A malformed cursor means "start from the beginning", never a 500.
    return null
  }
}

/**
 * Rows strictly after the cursor under `createdAt DESC, id DESC`.
 *
 * The second branch is what makes ties safe: rows sharing the cursor's
 * timestamp are included only when their id sorts below it, so a page boundary
 * landing inside a same-millisecond batch neither drops nor repeats a row.
 */
export function buildCursorWhere(cursor: AssetCursor | null): Prisma.AssetWhereInput | null {
  if (!cursor) return null

  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  }
}

/** Stable ordering. Every paginated asset query must use exactly this. */
export const ASSET_PAGE_ORDER_BY: Prisma.AssetOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "desc" },
]

export function clampPageSize(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested < 1) {
    return ASSET_PAGE_SIZE_DEFAULT
  }
  return Math.min(Math.trunc(requested), ASSET_PAGE_SIZE_MAX)
}

/**
 * Turn an over-fetched row set into a page.
 *
 * Callers request `limit + 1` rows; the extra row is the cheapest reliable
 * `hasMore` signal and is dropped from the returned items.
 */
export function buildAssetPage<T extends { id: string; createdAt: Date }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null; hasMore: boolean } {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items.at(-1)

  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeAssetCursor({ createdAt: last.createdAt, id: last.id }) : null,
  }
}
