/** Toast visual presets — ids are stored on user preferences and applied via `arciin-toast--{id}`. */

export const TOAST_STYLES = [
  "sonner",
  "frost",
  "silk",
  "pearl",
  "float",
  "vault",
  "signal",
  "echo",
  "dock",
  "pulse",
  "bloom",
  "chrome",
  "slate",
  "velvet",
  "compact",
] as const

export type ToastStyle = (typeof TOAST_STYLES)[number]

export type ToastStyleIcon =
  | "Sparkles"
  | "Layers"
  | "Cloud"
  | "Gem"
  | "Wind"
  | "Archive"
  | "Radio"
  | "Waves"
  | "PanelBottom"
  | "Activity"
  | "Flower2"
  | "Box"
  | "Moon"
  | "Feather"
  | "Minus"

export type ToastStyleMeta = {
  label: string
  tagline: string
  description: string
  icon: ToastStyleIcon
  height: string
  layout: string
  iconTreatment: string
}

/** Map retired styles so existing accounts keep a sensible preset. */
export const LEGACY_TOAST_STYLE_MAP: Record<string, ToastStyle> = {
  minimal: "compact",
  bordered: "chrome",
  "accent-bar": "bloom",
}

export const TOAST_STYLE_META: Record<ToastStyle, ToastStyleMeta> = {
  sonner: {
    label: "Lumen",
    tagline: "Balanced studio card",
    description: "Soft shadow, rounded badge icons — the default Arciin toast.",
    icon: "Sparkles",
    height: "Medium",
    layout: "Icon left · title + subtitle",
    iconTreatment: "28px tinted badge",
  },
  frost: {
    label: "Frost",
    tagline: "Cool glass edge",
    description: "Bright white with a cool border and airy spacing.",
    icon: "Cloud",
    height: "Medium",
    layout: "Icon left · airy padding",
    iconTreatment: "Frosted badge",
  },
  silk: {
    label: "Silk",
    tagline: "Gentle gradient frame",
    description: "Subtle vertical wash and feather-light border.",
    icon: "Wind",
    height: "Medium-tall",
    layout: "Icon left · soft gradient bg",
    iconTreatment: "Soft square badge",
  },
  pearl: {
    label: "Pearl",
    tagline: "Warm off-white",
    description: "Cream surface with warm gray type — easy on the eyes.",
    icon: "Gem",
    height: "Medium",
    layout: "Icon left · warm neutrals",
    iconTreatment: "Rounded pearl tile",
  },
  float: {
    label: "Float",
    tagline: "Deep elevation",
    description: "Higher shadow stack so alerts feel lifted off the UI.",
    icon: "Layers",
    height: "Medium",
    layout: "Icon left · strong shadow",
    iconTreatment: "Elevated badge",
  },
  vault: {
    label: "Vault",
    tagline: "Dense command card",
    description: "Tighter type and slightly narrower — for power users.",
    icon: "Archive",
    height: "Medium-short",
    layout: "Compact horizontal",
    iconTreatment: "Small square badge",
  },
  signal: {
    label: "Signal",
    tagline: "High-contrast type",
    description: "Crisp title weight with muted secondary line.",
    icon: "Radio",
    height: "Medium",
    layout: "Icon left · bold title",
    iconTreatment: "Signal dot badge",
  },
  echo: {
    label: "Echo",
    tagline: "Wide breathing room",
    description: "Extra horizontal padding and relaxed line height.",
    icon: "Waves",
    height: "Medium-tall",
    layout: "Spacious row",
    iconTreatment: "Wide badge",
  },
  dock: {
    label: "Dock",
    tagline: "Bottom-dock feel",
    description: "Flatter shadow and square corners — snaps like a docked bar.",
    icon: "PanelBottom",
    height: "Medium-short",
    layout: "Low profile row",
    iconTreatment: "Flat icon chip",
  },
  pulse: {
    label: "Pulse",
    tagline: "Status chip energy",
    description: "Slightly saturated surface with vivid success coloring.",
    icon: "Activity",
    height: "Medium",
    layout: "Icon left · vivid status",
    iconTreatment: "Pill status chip",
  },
  bloom: {
    label: "Bloom",
    tagline: "Accent-tinted wash",
    description: "Uses your accent color as a soft fill — no heavy left rail.",
    icon: "Flower2",
    height: "Medium-tall",
    layout: "Tinted card",
    iconTreatment: "Accent badge",
  },
  chrome: {
    label: "Chrome",
    tagline: "Crisp neutral frame",
    description: "Hairline zinc border and zero shadow — clean and precise.",
    icon: "Box",
    height: "Medium",
    layout: "Outlined card",
    iconTreatment: "Outlined circle",
  },
  slate: {
    label: "Slate",
    tagline: "Dark surface",
    description: "Charcoal card with light text for cinematic dashboards.",
    icon: "Moon",
    height: "Medium",
    layout: "Dark mode row",
    iconTreatment: "Light-on-dark badge",
  },
  velvet: {
    label: "Velvet",
    tagline: "Soft plush shadow",
    description: "Large radius and plush shadow — friendly and premium.",
    icon: "Feather",
    height: "Medium-tall",
    layout: "Rounded plush card",
    iconTreatment: "Large soft badge",
  },
  compact: {
    label: "Compact",
    tagline: "Minimal footprint",
    description: "Shortest toast — small type and inline icon.",
    icon: "Minus",
    height: "Short",
    layout: "Tight single block",
    iconTreatment: "18px inline glyph",
  },
}

export function getToastStyleLabel(style: ToastStyle) {
  return TOAST_STYLE_META[style].label
}

export function normalizeToastStyle(value: unknown, fallback: ToastStyle): ToastStyle {
  if (typeof value !== "string") return fallback
  if ((TOAST_STYLES as readonly string[]).includes(value)) return value as ToastStyle
  return LEGACY_TOAST_STYLE_MAP[value] ?? fallback
}
