"use client"

import { useCallback, useEffect, type ComponentType, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  Accessibility,
  Bell,
  Database,
  Gauge,
  Layers,
  Palette,
  Shield,
  ShieldAlert,
} from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { AccessibilityPanel } from "@/components/settings/accessibility-panel"
import { AiPanel } from "@/components/settings/ai-panel"
import { AiSecurityPanel } from "@/components/settings/ai-security-panel"
import { AccessControlPanel } from "@/components/settings/access-control-panel"
import { ApiProtectionPanel } from "@/components/settings/api-protection-panel"
import { AppearancePanel } from "@/components/settings/appearance-panel"
import { NotificationsSettingsPanel } from "@/components/settings/notifications-settings-panel"
import { StorageSettingsForm } from "@/components/settings/storage-settings-form"

type Tab =
  | "storage"
  | "access-control"
  | "api-protection"
  | "ai"
  | "ai-security"
  | "notifications"
  | "appearance"
  | "accessibility"

const VALID_TABS: Tab[] = [
  "storage",
  "access-control",
  "api-protection",
  "ai",
  "ai-security",
  "notifications",
  "appearance",
  "accessibility",
]

/** Old tab ids — route to a live destination. */
const LEGACY_TAB_ROUTES: Record<string, string> = {
  general: "/settings?tab=access-control",
  domain: "/settings/domain",
  updates: "/settings?tab=access-control",
  mail: "/settings?tab=notifications",
  data: "/settings?tab=storage",
  security: "/settings?tab=access-control",
}

const DEFAULT_TAB: Tab = "storage"

function tabFromSearchParam(value: string | null): Tab | null {
  if (!value) return null
  if (value === "developer" || value === "remote-access") return null
  if (LEGACY_TAB_ROUTES[value]) return null
  return VALID_TABS.includes(value as Tab) ? (value as Tab) : null
}

const NAV: { id: Tab; label: string; icon: ComponentType<{ className?: string }> }[][] = [
  [
    { id: "storage",        label: "Storage",        icon: Database    },
    { id: "access-control", label: "Access control", icon: Shield      },
    { id: "api-protection", label: "API protection", icon: Gauge       },
  ],
  [
    { id: "ai",          label: "Planning",    icon: Layers     },
    { id: "ai-security", label: "AI Security", icon: ShieldAlert },
  ],
  [
    { id: "notifications", label: "Notifications", icon: Bell         },
    { id: "appearance",    label: "Appearance",    icon: Palette      },
    { id: "accessibility", label: "Accessibility", icon: Accessibility },
  ],
]

const GROUP_LABELS: Record<number, string> = {
  0: "Instance",
  1: "Intelligence",
  2: "Personalization",
}

export function SettingsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rawTab = searchParams.get("tab")

  useEffect(() => {
    if (!rawTab) return
    if (rawTab === "developer") {
      router.replace("/developer")
      return
    }
    if (rawTab === "remote-access") {
      router.replace("/developer/web-sockets")
      return
    }
    const legacy = LEGACY_TAB_ROUTES[rawTab]
    if (legacy) {
      router.replace(legacy)
    }
  }, [rawTab, router])

  const tab = tabFromSearchParam(rawTab) ?? DEFAULT_TAB

  const setTab = useCallback(
    (next: Tab) => {
      router.replace(`/settings?tab=${next}`, { scroll: false })
    },
    [router],
  )

  const panels: Record<Tab, ReactNode> = {
    storage: <StorageSettingsForm />,
    "access-control": <AccessControlPanel />,
    "api-protection": <ApiProtectionPanel />,
    ai: <AiPanel />,
    "ai-security": <AiSecurityPanel />,
    notifications: <NotificationsSettingsPanel />,
    appearance: <AppearancePanel />,
    accessibility: <AccessibilityPanel />,
  }

  return (
    <div className="space-y-6 pb-8">
      <DashboardPageIntro
        title="Settings"
        subtitle="Instance · intelligence · personalization"
        description="Storage path, access control, API protection, AI planning, and account-level notifications and appearance."
        stats={[
          { label: "Instance", value: "3 areas" },
          { label: "Intelligence", value: "2 areas" },
          { label: "Personalization", value: "3 areas" },
        ]}
      />

      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
        <div className="shrink-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm sm:sticky sm:top-4 sm:w-60 sm:self-start">
          <nav className="flex gap-1 overflow-x-auto px-2.5 py-2.5 scrollbar-hide sm:block sm:space-y-3 sm:overflow-visible sm:px-2.5 sm:py-3.5">
            {NAV.map((group, gi) => (
              <div key={gi} className="sm:space-y-0.5">
                <p className="hidden px-3 pb-1.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 sm:block">
                  {GROUP_LABELS[gi]}
                </p>
                <div className="flex gap-1 sm:flex-col sm:gap-0.5">
                  {group.map(({ id, label, icon: Icon }) => {
                    const active = tab === id
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setTab(id)}
                        className={
                          active
                            ? "settings-nav-active shrink-0 whitespace-nowrap rounded-xl border px-3 py-2.5 text-left text-[12px] font-medium transition-colors sm:w-full"
                            : "shrink-0 whitespace-nowrap rounded-xl border border-transparent px-3 py-2.5 text-left text-[12px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 sm:w-full"
                        }
                      >
                        <span className="flex items-center gap-3">
                          <Icon className="size-4 shrink-0 opacity-90" />
                          {label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto rounded-2xl border border-border bg-card px-4 py-5 shadow-sm sm:px-7 sm:py-6">
          {panels[tab]}
        </div>
      </div>
    </div>
  )
}
