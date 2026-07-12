import { createElement, type SyntheticEvent, type ElementType, type ReactNode } from "react"
import { Link2 } from "lucide-react"

import {
  brandMarkForSource,
  sourceBrandIconSrc,
  sourceBrandIconTileBg,
} from "@/lib/utils/source-brand-icon"

export function toastLucideIcon(Icon: ElementType) {
  return createElement(Icon, { className: "arciin-toast-icon-svg", strokeWidth: 2.25 })
}

/** Brand logo tile for action toasts (YouTube, Instagram, …). Falls back to Lucide. */
export function toastSourceIcon(
  sourceKey: string,
  options?: { fallback?: ElementType; label?: string },
): ReactNode {
  const iconSrc = sourceBrandIconSrc(sourceKey)
  if (!iconSrc) {
    return toastLucideIcon(options?.fallback ?? Link2)
  }

  const tileBg = sourceBrandIconTileBg(sourceKey)
  const mark = brandMarkForSource(sourceKey)

  return createElement(
    "span",
    {
      className: "arciin-toast-brand-icon-wrap",
      style: { "--arciin-toast-brand-bg": tileBg },
      "aria-hidden": true,
      title: options?.label,
    },
    createElement("img", {
      src: iconSrc,
      alt: "",
      className: "arciin-toast-brand-icon",
      onError: (event: SyntheticEvent<HTMLImageElement>) => {
        const target = event.currentTarget
        const parent = target.parentElement
        if (!parent) return
        target.remove()
        const fallback = document.createElement("span")
        fallback.className = "arciin-toast-brand-fallback"
        fallback.textContent = mark
        parent.appendChild(fallback)
      },
    }),
  )
}
