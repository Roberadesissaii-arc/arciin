/** localStorage key read by the inline anti-flash script in app/layout.tsx (see ACCENT_FLASH_GUARD_SCRIPT). */
export const ACCENT_CACHE_KEY = "arciin-accent"

/** Push accent + derived tokens to :root and .dashboard-main for gradients, glows, and UI. */
export function applyAccentTokens(accent: string) {
  if (typeof document === "undefined") return

  try {
    // Cache so the next hard refresh can paint the real accent before React
    // hydrates, instead of flashing the CSS default (#ff4f12) first.
    window.localStorage.setItem(ACCENT_CACHE_KEY, accent)
  } catch {
    // Storage unavailable (private mode, quota) — flash guard just no-ops.
  }

  const root = document.documentElement
  root.style.setProperty("--arciin-accent", accent)
  root.style.setProperty("--arciin-accent-hover", `color-mix(in srgb, ${accent} 88%, white)`)
  root.style.setProperty("--arciin-accent-muted", `color-mix(in srgb, ${accent} 12%, transparent)`)
  root.style.setProperty("--arciin-accent-soft", `color-mix(in srgb, ${accent} 10%, white)`)
  root.style.setProperty("--arciin-accent-surface", `color-mix(in srgb, ${accent} 14%, #fafafa)`)
  root.style.setProperty("--arciin-accent-ring", `color-mix(in srgb, ${accent} 32%, transparent)`)
  root.style.setProperty("--arciin-accent-glow", `color-mix(in srgb, ${accent} 40%, transparent)`)
  root.style.setProperty("--arciin-accent-wash", `color-mix(in srgb, ${accent} 16%, transparent)`)
  root.style.setProperty(
    "--arciin-accent-icon-bg",
    `color-mix(in srgb, ${accent} 8%, transparent)`,
  )
  root.style.setProperty(
    "--arciin-accent-icon-border",
    `color-mix(in srgb, ${accent} 18%, transparent)`,
  )
  root.style.setProperty(
    "--arciin-accent-icon-ring",
    `color-mix(in srgb, ${accent} 15%, transparent)`,
  )
  root.style.setProperty(
    "--arciin-accent-badge-bg",
    `color-mix(in srgb, ${accent} 10%, transparent)`,
  )
  root.style.setProperty(
    "--arciin-accent-badge-border",
    `color-mix(in srgb, ${accent} 22%, transparent)`,
  )

  root.style.setProperty("--primary", accent)
  root.style.setProperty("--chart-1", accent)

  const main = document.querySelector(".dashboard-main")
  if (main instanceof HTMLElement) {
    main.style.setProperty("--primary", accent)
    main.style.setProperty("--chart-1", accent)
    main.style.setProperty("--ring", `color-mix(in srgb, ${accent} 28%, transparent)`)
  }
}
