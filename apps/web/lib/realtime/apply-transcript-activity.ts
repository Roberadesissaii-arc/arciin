import type { QueryClient } from "@tanstack/react-query"

import type { AssetAiActivity, AssetSummary } from "@/lib/types/models"

/**
 * Apply a transcript realtime event to cached asset listings.
 *
 * Invalidating and waiting for a refetch is not enough: `staleTime` plus
 * `placeholderData` can keep a card on an older terminal state (`failed`)
 * after the database has already moved to PROCESSING or READY. Events carry
 * `createdAt`, so an older announcement cannot overwrite a newer one.
 */

export type TranscriptRealtimeType =
  | "asset.transcript.updated"
  | "asset.transcript.ready"
  | "asset.transcript.failed"

export function isTranscriptRealtimeType(type: string): type is TranscriptRealtimeType {
  return (
    type === "asset.transcript.updated" ||
    type === "asset.transcript.ready" ||
    type === "asset.transcript.failed"
  )
}

export function activityFromTranscriptEvent(
  type: TranscriptRealtimeType,
  createdAt: string,
): AssetAiActivity | null {
  if (type === "asset.transcript.ready") return null
  if (type === "asset.transcript.failed") {
    return {
      active: false,
      kind: "transcript",
      label: "Transcript",
      stage: null,
      updatedAt: createdAt,
      status: "failed",
    }
  }
  return {
    active: true,
    kind: "transcript",
    label: "Transcript",
    stage: "Generating transcript",
    updatedAt: createdAt,
    status: "running",
  }
}

/** True when `incoming` is strictly newer than the activity already on the card. */
export function transcriptEventIsNewer(
  incomingCreatedAt: string,
  currentUpdatedAt: string | null | undefined,
): boolean {
  if (!currentUpdatedAt) return true
  const incoming = Date.parse(incomingCreatedAt)
  const current = Date.parse(currentUpdatedAt)
  if (Number.isNaN(incoming)) return false
  if (Number.isNaN(current)) return true
  return incoming >= current
}

function patchAsset(asset: AssetSummary, nextActivity: AssetAiActivity | null): AssetSummary {
  const languageCount = asset.ai?.languageCount ?? 0
  return {
    ...asset,
    ai: {
      languageCount,
      activity: nextActivity,
    },
  }
}

function mapCachedAssets(
  old: unknown,
  assetId: string,
  createdAt: string,
  nextActivity: AssetAiActivity | null,
): unknown {
  if (!old) return old

  const apply = (asset: AssetSummary): AssetSummary => {
    if (asset.id !== assetId) return asset
    if (!transcriptEventIsNewer(createdAt, asset.ai?.activity?.updatedAt)) return asset
    return patchAsset(asset, nextActivity)
  }

  if (Array.isArray(old)) {
    return (old as AssetSummary[]).map(apply)
  }

  const paged = old as { pages?: { items?: AssetSummary[] }[] }
  if (Array.isArray(paged.pages)) {
    return {
      ...paged,
      pages: paged.pages.map((page) =>
        Array.isArray(page?.items) ? { ...page, items: page.items.map(apply) } : page,
      ),
    }
  }

  return old
}

export function applyTranscriptRealtimeToAssetCache(
  queryClient: QueryClient,
  input: { type: TranscriptRealtimeType; assetId: string; createdAt: string },
): void {
  if (!input.assetId) return
  const next = activityFromTranscriptEvent(input.type, input.createdAt)
  queryClient.setQueriesData({ queryKey: ["assets"] }, (old: unknown) =>
    mapCachedAssets(old, input.assetId, input.createdAt, next),
  )
}
