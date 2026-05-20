import {
  TOAST_STYLES,
  TOAST_STYLE_META,
  getToastStyleLabel,
  normalizeToastStyle,
  type ToastStyle,
} from "./toast-styles"

export { TOAST_STYLES, TOAST_STYLE_META, getToastStyleLabel, type ToastStyle }

export const FONT_SIZE_OPTIONS = ["Small", "Normal", "Large", "Extra Large"] as const
export type FontSizeOption = (typeof FONT_SIZE_OPTIONS)[number]

export const ACCENT_COLORS = [
  { hex: "#FF4F12", label: "Arciin Orange", group: "Brand" },
  { hex: "#f97316", label: "Amber", group: "Warm" },
  { hex: "#eab308", label: "Gold", group: "Warm" },
  { hex: "#e11d48", label: "Rose", group: "Warm" },
  { hex: "#ec4899", label: "Pink", group: "Warm" },
  { hex: "#d946ef", label: "Fuchsia", group: "Vivid" },
  { hex: "#8b5cf6", label: "Violet", group: "Vivid" },
  { hex: "#7c3aed", label: "Purple", group: "Vivid" },
  { hex: "#5D5FEF", label: "Indigo", group: "Cool" },
  { hex: "#3b82f6", label: "Blue", group: "Cool" },
  { hex: "#0ea5e9", label: "Sky", group: "Cool" },
  { hex: "#06b6d4", label: "Cyan", group: "Cool" },
  { hex: "#0d9488", label: "Teal", group: "Cool" },
  { hex: "#10b981", label: "Emerald", group: "Cool" },
  { hex: "#22c55e", label: "Green", group: "Cool" },
  { hex: "#64748b", label: "Slate", group: "Neutral" },
] as const

export const TOAST_POSITIONS = [
  "bottom-right",
  "bottom-left",
  "top-right",
  "top-left",
] as const
export type ToastPosition = (typeof TOAST_POSITIONS)[number]

export const UI_RADIUS_OPTIONS = ["comfortable", "compact", "sharp"] as const
export type UiRadius = (typeof UI_RADIUS_OPTIONS)[number]

export type NotificationPreferences = {
  uploadSound: boolean
  uploadCompleteToast: boolean
  uploadFailedToast: boolean
  activityFeedToast: boolean
  securityEventsToast: boolean
}

export type AppearancePreferences = {
  compactView: boolean
  animatedCards: boolean
  accentColor: string
  toastPosition: ToastPosition
  toastStyle: ToastStyle
  toastShowIcons: boolean
  uiRadius: UiRadius
}

export type AccessibilityPreferences = {
  fontSize: FontSizeOption
  reduceAnimations: boolean
  highContrast: boolean
  keyboardNav: boolean
}

/** Technical media options (off by default). */
export type MediaPreferences = {
  /** Render first-page previews for PDFs and queue thumbnail jobs. */
  documentThumbnails: boolean
}

export type UserPreferences = {
  notifications: NotificationPreferences
  appearance: AppearancePreferences
  accessibility: AccessibilityPreferences
  media: MediaPreferences
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  notifications: {
    uploadSound: true,
    uploadCompleteToast: true,
    uploadFailedToast: true,
    activityFeedToast: true,
    securityEventsToast: false,
  },
  appearance: {
    compactView: false,
    animatedCards: true,
    accentColor: "#FF4F12",
    toastPosition: "bottom-right",
    toastStyle: "sonner",
    toastShowIcons: true,
    uiRadius: "comfortable",
  },
  accessibility: {
    fontSize: "Normal",
    reduceAnimations: false,
    highContrast: false,
    keyboardNav: false,
  },
  media: {
    documentThumbnails: false,
  },
}

const FONT_SIZE_SET = new Set<string>(FONT_SIZE_OPTIONS)
const ACCENT_SET = new Set<string>(ACCENT_COLORS.map((c) => c.hex))
const TOAST_POSITION_SET = new Set<string>(TOAST_POSITIONS)
const UI_RADIUS_SET = new Set<string>(UI_RADIUS_OPTIONS)

function asBool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function asFontSize(value: unknown, fallback: FontSizeOption): FontSizeOption {
  return typeof value === "string" && FONT_SIZE_SET.has(value) ? (value as FontSizeOption) : fallback
}

function asAccent(value: unknown, fallback: string) {
  return typeof value === "string" && ACCENT_SET.has(value) ? value : fallback
}

function asToastPosition(value: unknown, fallback: ToastPosition): ToastPosition {
  return typeof value === "string" && TOAST_POSITION_SET.has(value)
    ? (value as ToastPosition)
    : fallback
}

function asToastStyle(value: unknown, fallback: ToastStyle): ToastStyle {
  return normalizeToastStyle(value, fallback)
}

function asUiRadius(value: unknown, fallback: UiRadius): UiRadius {
  return typeof value === "string" && UI_RADIUS_SET.has(value) ? (value as UiRadius) : fallback
}

export function parseUserPreferences(raw: unknown): UserPreferences {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const notifications =
    root.notifications && typeof root.notifications === "object"
      ? (root.notifications as Record<string, unknown>)
      : {}
  const appearance =
    root.appearance && typeof root.appearance === "object"
      ? (root.appearance as Record<string, unknown>)
      : {}
  const accessibility =
    root.accessibility && typeof root.accessibility === "object"
      ? (root.accessibility as Record<string, unknown>)
      : {}
  const media =
    root.media && typeof root.media === "object" ? (root.media as Record<string, unknown>) : {}

  const defaults = DEFAULT_USER_PREFERENCES

  return {
    notifications: {
      uploadSound: asBool(notifications.uploadSound, defaults.notifications.uploadSound),
      uploadCompleteToast: asBool(
        notifications.uploadCompleteToast,
        defaults.notifications.uploadCompleteToast,
      ),
      uploadFailedToast: asBool(
        notifications.uploadFailedToast,
        defaults.notifications.uploadFailedToast,
      ),
      activityFeedToast: asBool(
        notifications.activityFeedToast,
        defaults.notifications.activityFeedToast,
      ),
      securityEventsToast: asBool(
        notifications.securityEventsToast,
        defaults.notifications.securityEventsToast,
      ),
    },
    appearance: {
      compactView: asBool(appearance.compactView, defaults.appearance.compactView),
      animatedCards: asBool(appearance.animatedCards, defaults.appearance.animatedCards),
      accentColor: asAccent(appearance.accentColor, defaults.appearance.accentColor),
      toastPosition: asToastPosition(appearance.toastPosition, defaults.appearance.toastPosition),
      toastStyle: asToastStyle(appearance.toastStyle, defaults.appearance.toastStyle),
      toastShowIcons: asBool(appearance.toastShowIcons, defaults.appearance.toastShowIcons),
      uiRadius: asUiRadius(appearance.uiRadius, defaults.appearance.uiRadius),
    },
    accessibility: {
      fontSize: asFontSize(accessibility.fontSize, defaults.accessibility.fontSize),
      reduceAnimations: asBool(
        accessibility.reduceAnimations,
        defaults.accessibility.reduceAnimations,
      ),
      highContrast: asBool(accessibility.highContrast, defaults.accessibility.highContrast),
      keyboardNav: asBool(accessibility.keyboardNav, defaults.accessibility.keyboardNav),
    },
    media: {
      documentThumbnails: asBool(
        media.documentThumbnails,
        defaults.media.documentThumbnails,
      ),
    },
  }
}

export function mergeUserPreferences(
  current: UserPreferences,
  patch: Partial<{
    notifications: Partial<NotificationPreferences>
    appearance: Partial<AppearancePreferences>
    accessibility: Partial<AccessibilityPreferences>
    media: Partial<MediaPreferences>
  }>,
): UserPreferences {
  return parseUserPreferences({
    notifications: { ...current.notifications, ...patch.notifications },
    appearance: { ...current.appearance, ...patch.appearance },
    accessibility: { ...current.accessibility, ...patch.accessibility },
    media: { ...current.media, ...patch.media },
  })
}

export function getAccentLabel(hex: string) {
  return ACCENT_COLORS.find((c) => c.hex === hex)?.label ?? "Custom"
}

