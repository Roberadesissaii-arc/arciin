import type { ComponentType } from "react"
import {
  Accessibility,
  Bell,
  Database,
  Eraser,
  Gauge,
  Globe,
  Smartphone,
  FingerprintPattern,
  Layers,
  LogOut,
  Palette,
  Shield,
  ShieldAlert,
} from "lucide-react"

export type SettingsTab =
  | "storage"
  | "domain"
  | "mobile"
  | "passwords"
  | "data-reset"
  | "access-control"
  | "session"
  | "api-protection"
  | "ai"
  | "ai-security"
  | "notifications"
  | "appearance"
  | "accessibility"

export const SETTINGS_VALID_TABS: SettingsTab[] = [
  "storage",
  "domain",
  "mobile",
  "passwords",
  "data-reset",
  "access-control",
  "session",
  "api-protection",
  "ai",
  "ai-security",
  "notifications",
  "appearance",
  "accessibility",
]

export const SETTINGS_DEFAULT_TAB: SettingsTab = "storage"

export const SETTINGS_LEGACY_TAB_ROUTES: Record<string, string> = {
  general: "/settings?tab=access-control",
  updates: "/settings?tab=access-control",
  mail: "/settings?tab=notifications",
  data: "/settings?tab=storage",
  security: "/settings?tab=access-control",
}

export type SettingsNavItem = {
  id: SettingsTab
  label: string
  icon: ComponentType<{ className?: string }>
}

export const SETTINGS_NAV: SettingsNavItem[][] = [
  [
    { id: "storage", label: "Storage", icon: Database },
    { id: "domain", label: "Domain", icon: Globe },
    { id: "mobile", label: "Mobile connection", icon: Smartphone },
  ],
  [
    { id: "passwords", label: "Passwords", icon: FingerprintPattern },
    { id: "access-control", label: "Access control", icon: Shield },
    { id: "session", label: "Session", icon: LogOut },
    { id: "api-protection", label: "API protection", icon: Gauge },
    { id: "data-reset", label: "Data reset", icon: Eraser },
  ],
  [
    { id: "ai", label: "Planning", icon: Layers },
    { id: "ai-security", label: "AI Security", icon: ShieldAlert },
  ],
  [
    { id: "notifications", label: "Notifications", icon: Bell },
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "accessibility", label: "Accessibility", icon: Accessibility },
  ],
]

export const SETTINGS_GROUP_LABELS: Record<number, string> = {
  0: "Instance",
  1: "Security",
  2: "Intelligence",
  3: "Personalization",
}

export function settingsTabFromParam(value: string | null): SettingsTab | null {
  if (!value) return null
  if (value === "developer" || value === "remote-access") return null
  if (SETTINGS_LEGACY_TAB_ROUTES[value]) return null
  return SETTINGS_VALID_TABS.includes(value as SettingsTab) ? (value as SettingsTab) : null
}
