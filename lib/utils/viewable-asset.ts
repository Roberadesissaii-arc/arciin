import { assetSupportsDocumentThumbnail } from "@arciin/shared"

import type { AssetSummary } from "@/lib/types/models"

/** Assets that can open in the in-app viewer (images, PDFs, inline video). */
export function isViewableAsset(asset: AssetSummary): boolean {
  if (asset.mediaType === "IMAGE" || asset.mediaType === "VIDEO") {
    return true
  }
  return assetSupportsDocumentThumbnail(
    asset.mediaType,
    asset.mimeType,
    asset.extension,
    asset.originalFilename,
  )
}

export function filterViewableAssets(assets: AssetSummary[]): AssetSummary[] {
  return assets.filter(isViewableAsset)
}
