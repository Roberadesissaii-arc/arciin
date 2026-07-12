import type { CSSProperties } from "react"

/** Lighter stop for the animated toast border ring. */
export function toastOrbitHighlight(color: string) {
  return `color-mix(in srgb, ${color} 70%, white)`
}

export function applyToastOrbitTokens(color: string) {
  if (typeof document === "undefined") return

  const root = document.documentElement
  root.style.setProperty("--arciin-toast-orbit-a", color)
  root.style.setProperty("--arciin-toast-orbit-b", toastOrbitHighlight(color))
}

export function toastOrbitStyle(color: string): CSSProperties {
  const highlight = toastOrbitHighlight(color)
  return {
    "--arciin-toast-orbit-a": color,
    "--arciin-toast-orbit-b": highlight,
    "--arciin-orbit-a": color,
    "--arciin-orbit-b": highlight,
  } as CSSProperties
}
