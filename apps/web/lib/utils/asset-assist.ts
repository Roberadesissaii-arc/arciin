import { isTextAssistAsset } from "@/lib/api/documents"
import type { AssetSummary } from "@/lib/types/models"

/** Files that get Assist on the card menu and in the side panel. */
export function assetOffersAssist(asset: AssetSummary): boolean {
  if (asset.mediaType === "VIDEO" || asset.mediaType === "AUDIO" || asset.mediaType === "IMAGE") {
    return true
  }
  return isTextAssistAsset(asset)
}

/** Transcript / title / summarize — same Assist workspace for video and music. */
export function assetOffersMediaAssist(asset: AssetSummary): boolean {
  return asset.mediaType === "VIDEO" || asset.mediaType === "AUDIO"
}
