import type { AssetSummary } from "@/lib/types/models"

export function thumbnailStatusLabel(
  asset: AssetSummary,
  thumbLoading: boolean,
  readyExt?: string,
): string {
  if (asset.status !== "READY") {
    return asset.status === "PROCESSING" ? "Processing" : asset.status
  }
  if (thumbLoading) return "Processing"
  return readyExt ?? ""
}

export function ThumbnailStatusBadge({ label }: { label: string }) {
  if (!label) return null
  return (
    <span
      data-preview-chrome
      className="pointer-events-none absolute bottom-2 right-2 z-10 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm"
    >
      {label}
    </span>
  )
}
