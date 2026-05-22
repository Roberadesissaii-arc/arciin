import {
  assetSupportsDocumentThumbnail,
  getFileExtension,
  isCodeFilename,
  codeExtensions,
} from "@arciin/shared"

import type { AssetSummary } from "@/lib/types/models"

const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "webm",
  "mov",
  "mkv",
  "avi",
  "m4v",
  "mpeg",
  "mpg",
  "ogv",
  "3gp",
  "3g2",
])

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "flac", "aac", "ogg", "m4a", "opus", "wma"])

export function isCodeOrTextAsset(asset: AssetSummary): boolean {
  if (asset.mediaType === "CODE") return true
  const ext = (asset.extension ?? getFileExtension(asset.originalFilename)).toLowerCase()
  if (codeExtensions.has(ext) || isCodeFilename(asset.originalFilename)) return true
  if (/\.(txt|md|markdown|log|csv|tsv)$/i.test(asset.originalFilename)) return true
  const mime = (asset.mimeType ?? "").toLowerCase()
  if (mime.startsWith("text/") || mime === "application/json" || mime === "application/xml") {
    return true
  }
  return false
}

export function isVideoLikeAsset(asset: AssetSummary): boolean {
  if (asset.mediaType === "VIDEO") return true
  const mime = (asset.mimeType ?? "").toLowerCase()
  if (mime.startsWith("video/")) return true
  const ext = (asset.extension ?? getFileExtension(asset.originalFilename)).toLowerCase()
  return VIDEO_EXTENSIONS.has(ext)
}

export function isAudioLikeAsset(asset: AssetSummary): boolean {
  if (asset.mediaType === "AUDIO") return true
  const mime = (asset.mimeType ?? "").toLowerCase()
  if (mime.startsWith("audio/")) return true
  const ext = (asset.extension ?? getFileExtension(asset.originalFilename)).toLowerCase()
  return AUDIO_EXTENSIONS.has(ext)
}

/** Assets that can open in the in-app viewer (images, PDFs, video, audio, code/text). */
export function isViewableAsset(asset: AssetSummary): boolean {
  if (asset.mediaType === "IMAGE") return true
  if (isVideoLikeAsset(asset)) return true
  if (isAudioLikeAsset(asset)) return true
  if (isCodeOrTextAsset(asset)) return true
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
