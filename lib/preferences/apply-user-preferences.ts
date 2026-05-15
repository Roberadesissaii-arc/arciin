import {
  DEFAULT_USER_PREFERENCES,
  type FontSizeOption,
  type UserPreferences,
} from "@arciin/shared"

import { applyAccentTokens } from "@/lib/preferences/accent-tokens"

const FONT_PX: Record<FontSizeOption, string> = {
  Small: "13px",
  Normal: "15px",
  Large: "17px",
  "Extra Large": "19px",
}

const FONT_ZOOM: Record<FontSizeOption, string> = {
  Small: "0.88",
  Normal: "1",
  Large: "1.12",
  "Extra Large": "1.22",
}

const UI_RADIUS_PX: Record<UserPreferences["appearance"]["uiRadius"], string> = {
  comfortable: "0.625rem",
  compact: "0.5rem",
  sharp: "0.35rem",
}

function osPrefersReducedMotion() {
  if (typeof window === "undefined") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function applyUserPreferences(preferences: UserPreferences) {
  if (typeof document === "undefined") return

  const { appearance, accessibility } = preferences
  const root = document.documentElement
  const reduceMotion = accessibility.reduceAnimations || osPrefersReducedMotion()

  applyAccentTokens(appearance.accentColor)

  root.style.setProperty("--app-font-size", FONT_PX[accessibility.fontSize] ?? "15px")
  root.style.setProperty("--radius", UI_RADIUS_PX[appearance.uiRadius])

  root.dataset.a11yFont = accessibility.fontSize
  root.dataset.toastStyle = appearance.toastStyle
  root.dataset.toastPosition = appearance.toastPosition
  root.dataset.toastIcons = appearance.toastShowIcons ? "1" : "0"
  root.dataset.uiRadius = appearance.uiRadius

  root.classList.toggle("compact-view", appearance.compactView)
  root.classList.toggle("no-animated-cards", !appearance.animatedCards)
  root.classList.toggle("reduce-motion", reduceMotion)
  root.classList.toggle("high-contrast", accessibility.highContrast)
  root.classList.toggle("keyboard-nav", accessibility.keyboardNav)
  root.classList.toggle("toast-hide-icons", !appearance.toastShowIcons)

  const scaled = document.getElementById("dashboard-scaled-content")
  if (scaled instanceof HTMLElement) {
    scaled.style.zoom = FONT_ZOOM[accessibility.fontSize] ?? "1"
    scaled.style.fontSize = FONT_PX[accessibility.fontSize] ?? "15px"
  }
}

export function applyUserPreferencesDefaults() {
  applyUserPreferences(DEFAULT_USER_PREFERENCES)
}
