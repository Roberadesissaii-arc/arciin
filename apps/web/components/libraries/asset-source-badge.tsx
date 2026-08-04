"use client"

import { Globe, Monitor, Smartphone } from "lucide-react"

import { resolveAssetBadge } from "@/lib/utils/asset-badge"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

type AssetBadgeProps = {
  asset: Pick<
    AssetSummary,
    "importSourceUrl" | "uploadClient" | "badgeLabel" | "badgeColor" | "showBadge"
  >
  className?: string
  /**
   * When false, never wrap the chip in an <a> (required when nested inside a parent Link).
   * Default true.
   */
  link?: boolean
  /** Live preview overrides (edit dialog). */
  preview?: {
    label?: string
    color?: string
    show?: boolean
  }
}

/**
 * Brand-colored chip on asset cards — auto-detected from import link or customized per file.
 */
export function AssetSourceBadge({ asset, className, link = true, preview }: AssetBadgeProps) {
  const resolved = resolveAssetBadge(asset)
  if (preview?.show === false) return null

  const label = preview?.label?.trim() || resolved?.label
  const color = preview?.color?.trim() || resolved?.color
  const href = resolved?.href
  const key = resolved?.key ?? "custom"

  if (!label || !color) return null

  const chip = (
    <span
      style={{ backgroundColor: color }}
      className={cn(
        "inline-flex max-w-[9rem] items-center gap-1 rounded-md px-2 py-[3px] text-[11px] font-semibold leading-[1.35] text-white shadow-sm ring-1 ring-black/10",
        href && link && "transition-opacity hover:opacity-90",
        className,
      )}
      title={href ? `Imported from ${label}` : undefined}
    >
      {key === "web" || key === "custom" ? <Globe className="size-2.5 shrink-0" /> : null}
      {key === "device-web" ? <Monitor className="size-2.5 shrink-0" /> : null}
      {key === "device-mobile" ? <Smartphone className="size-2.5 shrink-0" /> : null}
      <span className="truncate">{label}</span>
    </span>
  )

  if (!href || !link) return chip

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(event) => event.stopPropagation()}
      title={`Imported from ${label}`}
      className="inline-flex"
    >
      {chip}
    </a>
  )
}
