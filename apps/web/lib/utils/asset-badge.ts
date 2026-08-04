import { detectAssetSource } from "@/lib/utils/asset-source"
import type { AssetSummary } from "@/lib/types/models"

export type ResolvedAssetBadge = {
  label: string
  color: string
  href: string | null
  key: string
  isCustomLabel: boolean
  isCustomColor: boolean
  autoLabel: string | null
  autoColor: string | null
}

/** Fallback badge for assets with no import source — labels which device sent the upload. */
function deviceBadge(uploadClient: string | null | undefined): { key: string; label: string; color: string } | null {
  if (uploadClient === "mobile") return { key: "device-mobile", label: "Phone", color: "#52525b" }
  if (uploadClient === "web") return { key: "device-web", label: "Computer", color: "#52525b" }
  if (uploadClient === "api") return { key: "device-api", label: "API", color: "#FF4F12" }
  return null
}

/** Resolve the badge shown on an asset card (custom overrides + import source auto-detect + upload device fallback). */
export function resolveAssetBadge(asset: Pick<
  AssetSummary,
  "importSourceUrl" | "uploadClient" | "badgeLabel" | "badgeColor" | "showBadge"
>): ResolvedAssetBadge | null {
  if (asset.showBadge === false) return null

  const auto = detectAssetSource(asset.importSourceUrl)
  const device = auto ? null : deviceBadge(asset.uploadClient)
  const label = asset.badgeLabel?.trim() || auto?.label || device?.label || null
  if (!label) return null

  const autoColor = auto?.color ?? device?.color ?? null
  const color = asset.badgeColor?.trim() || autoColor || "#3f3f46"

  return {
    label,
    color,
    href: asset.importSourceUrl ?? null,
    key: auto?.key ?? device?.key ?? "custom",
    isCustomLabel: Boolean(asset.badgeLabel?.trim()),
    isCustomColor: Boolean(asset.badgeColor?.trim()),
    autoLabel: auto?.label ?? device?.label ?? null,
    autoColor,
  }
}

export const BADGE_COLOR_PRESETS = [
  { id: "arciin", label: "Arciin", color: "#FF4F12" },
  { id: "orange", label: "Ember", color: "#FF6A33" },
  { id: "youtube", label: "YouTube", color: "#FF0000" },
  { id: "amazon", label: "Amazon", color: "#FF9900" },
  { id: "vimeo", label: "Vimeo", color: "#1AB7EA" },
  { id: "spotify", label: "Spotify", color: "#1DB954" },
  { id: "github", label: "GitHub", color: "#181717" },
  { id: "purple", label: "Purple", color: "#8B5CF6" },
  { id: "info", label: "Sky", color: "#38BDF8" },
  { id: "success", label: "Green", color: "#22C55E" },
  { id: "warning", label: "Amber", color: "#F59E0B" },
  { id: "danger", label: "Red", color: "#EF4444" },
  { id: "zinc", label: "Zinc", color: "#3F3F46" },
] as const

export function isValidBadgeColor(value: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(value.trim())
}
