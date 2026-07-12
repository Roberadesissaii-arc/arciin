"use client"

import { useState } from "react"
import { Globe } from "lucide-react"

import {
  brandMarkForSource,
  sourceBrandIconSrc,
  sourceBrandIconTileBg,
} from "@/lib/utils/source-brand-icon"
import { cn } from "@/lib/utils"

type SourceBrandMarkProps = {
  sourceKey: string
  brandColor: string
  label: string
  size?: "sm" | "md"
  className?: string
}

/** Brand logo from SVG when available, otherwise colored initials. */
export function SourceBrandMark({
  sourceKey,
  brandColor,
  label,
  size = "md",
  className,
}: SourceBrandMarkProps) {
  const [iconFailed, setIconFailed] = useState(false)
  const iconSrc = sourceBrandIconSrc(sourceKey)
  const showIcon = Boolean(iconSrc) && !iconFailed
  const iconTileBg = showIcon ? sourceBrandIconTileBg(sourceKey) : brandColor

  const boxClass =
    size === "sm" ? "size-8 rounded-md text-[10px]" : "size-9 rounded-lg text-[11px]"

  const imageClass = size === "sm" ? "size-4" : "size-5"

  if (sourceKey === "web") {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center bg-muted text-muted-foreground ring-1 ring-black/10",
          boxClass,
          className,
        )}
        aria-hidden
      >
        <Globe className={size === "sm" ? "size-3.5" : "size-4"} />
      </div>
    )
  }

  return (
    <div
      style={{ backgroundColor: iconTileBg }}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden font-bold text-white ring-1 ring-black/10",
        boxClass,
        className,
      )}
      aria-hidden
    >
      {showIcon ? (
        <img
          src={iconSrc!}
          alt=""
          width={size === "sm" ? 16 : 20}
          height={size === "sm" ? 16 : 20}
          className={cn(imageClass, "object-contain")}
          onError={() => setIconFailed(true)}
        />
      ) : (
        <span>{brandMarkForSource(sourceKey)}</span>
      )}
      <span className="sr-only">{label}</span>
    </div>
  )
}
