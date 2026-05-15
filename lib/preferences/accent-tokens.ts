/** Push accent + derived tokens to :root and .dashboard-main for gradients, glows, and UI. */
export function applyAccentTokens(accent: string) {
  if (typeof document === "undefined") return

  const root = document.documentElement
  root.style.setProperty("--arciin-accent", accent)
  root.style.setProperty("--arciin-accent-hover", `color-mix(in srgb, ${accent} 88%, white)`)
  root.style.setProperty("--arciin-accent-muted", `color-mix(in srgb, ${accent} 12%, transparent)`)
  root.style.setProperty("--arciin-accent-soft", `color-mix(in srgb, ${accent} 10%, white)`)
  root.style.setProperty("--arciin-accent-surface", `color-mix(in srgb, ${accent} 14%, #fafafa)`)
  root.style.setProperty("--arciin-accent-ring", `color-mix(in srgb, ${accent} 32%, transparent)`)
  root.style.setProperty("--arciin-accent-glow", `color-mix(in srgb, ${accent} 40%, transparent)`)
  root.style.setProperty("--arciin-accent-wash", `color-mix(in srgb, ${accent} 16%, transparent)`)

  const main = document.querySelector(".dashboard-main")
  if (main instanceof HTMLElement) {
    main.style.setProperty("--primary", accent)
    main.style.setProperty("--chart-1", accent)
    main.style.setProperty("--ring", `color-mix(in srgb, ${accent} 28%, transparent)`)
  }
}
