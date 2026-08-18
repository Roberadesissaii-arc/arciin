/**
 * Document Assist API — PDF metadata backfill + summarize.
 */

import { fetchApi } from "@/lib/api/client"
import type { AssetSummary } from "@/lib/types/models"

export type DocumentInsight = NonNullable<AssetSummary["documentInsight"]>

/** Lazily extract page count / author for older PDFs. */
export function ensureDocumentMetadata(assetId: string) {
  return fetchApi<AssetSummary>(`/assets/${assetId}/document-metadata`, {
    method: "POST",
    body: {},
  })
}

/** Summarize a PDF from extracted text; persists documentInsight on the asset. */
export function requestDocumentSummary(assetId: string, input?: { profileId?: string }) {
  return fetchApi<DocumentInsight>(`/assets/${assetId}/document-summary`, {
    method: "POST",
    body: input ?? {},
  })
}

/** Short AI title suggestions from PDF text (does not rename until Apply). */
export function requestDocumentTitleSuggestions(
  assetId: string,
  input?: { profileId?: string; count?: number },
) {
  return fetchApi<{ titles: string[]; model: string }>(
    `/assets/${assetId}/document-title-suggestions`,
    {
      method: "POST",
      body: input ?? {},
    },
  )
}

export function isPdfAsset(asset: Pick<AssetSummary, "originalFilename" | "mimeType" | "mediaType">) {
  if (asset.mediaType !== "DOCUMENT") return false
  if (/\.pdf$/i.test(asset.originalFilename)) return true
  return (asset.mimeType ?? "").toLowerCase() === "application/pdf"
}
