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
    <span className="pointer-events-none absolute bottom-1.5 right-2 z-10 rounded-md bg-black/35 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90 backdrop-blur-sm">
      {label}
    </span>
  )
}
