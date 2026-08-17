import type { ComponentType } from "react"
import {
  AudioWaveform,
  Accessibility,
  Bell,
  Database,
  Eraser,
  Gauge,
  Globe,
  FingerprintPattern,
  HardDrive,
  KeyRound,
  Layers,
  LogOut,
  Mail,
  Palette,
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react"

export type SettingsTab =
  | "storage"
  | "attached-disks"
  | "domain"
  | "email"
  | "license"
  | "updates"
  | "passwords"
  | "trash"
  | "data-reset"
  | "access-control"
  | "session"
  | "api-protection"
  | "ai"
  | "audio-separation"
  | "ai-security"
  | "notifications"
  | "appearance"
  | "accessibility"

export const SETTINGS_VALID_TABS: SettingsTab[] = [
  "audio-separation",
  "storage",
  "attached-disks",
  "domain",
  "email",
  "license",
  "updates",
  "passwords",
  "trash",
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
  mail: "/settings?tab=notifications",
  data: "/settings?tab=storage",
  security: "/settings?tab=access-control",
  mobile: "/settings?tab=domain",
}

export type SettingsNavItem = {
  id: SettingsTab
  label: string
  icon: ComponentType<{ className?: string }>
}

export const SETTINGS_NAV: SettingsNavItem[][] = [
  [
    { id: "storage", label: "Storage", icon: Database },
    { id: "attached-disks", label: "Attached disks", icon: HardDrive },
    { id: "domain", label: "Domain", icon: Globe },
    { id: "email", label: "Email & Discord", icon: Mail },
    { id: "license", label: "License", icon: KeyRound },
    { id: "updates", label: "Updates", icon: Sparkles },
  ],
  [
    { id: "passwords", label: "Passwords", icon: FingerprintPattern },
    { id: "trash", label: "Trash", icon: Trash2 },
    { id: "access-control", label: "Access control", icon: Shield },
    { id: "session", label: "Session", icon: LogOut },
    { id: "api-protection", label: "API protection", icon: Gauge },
    { id: "data-reset", label: "Data reset", icon: Eraser },
  ],
  [
    { id: "ai", label: "Planning", icon: Layers },
    // Where dubbing's expensive half runs, and the provider that runs it.
    { id: "audio-separation", label: "Audio separation", icon: AudioWaveform },
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

/** Intro stat chips derived from the real nav groups (not hardcoded). */
export function settingsIntroStats(): { label: string; value: string }[] {
  return SETTINGS_NAV.map((group, index) => {
    const count = group.length
    return {
      label: SETTINGS_GROUP_LABELS[index] ?? "Settings",
      value: `${count} area${count === 1 ? "" : "s"}`,
    }
  })
}

export function settingsTabFromParam(value: string | null): SettingsTab | null {
  if (!value) return null
  if (value === "developer" || value === "remote-access") return null
  if (SETTINGS_LEGACY_TAB_ROUTES[value]) return null
  return SETTINGS_VALID_TABS.includes(value as SettingsTab) ? (value as SettingsTab) : null
}
