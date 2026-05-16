"use client"

import { useCallback, useEffect, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { AccessibilityPanel } from "@/components/settings/accessibility-panel"
import { AiPanel } from "@/components/settings/ai-panel"
import { AiSecurityPanel } from "@/components/settings/ai-security-panel"
import { AccessControlPanel } from "@/components/settings/access-control-panel"
import { ApiProtectionPanel } from "@/components/settings/api-protection-panel"
import { AppearancePanel } from "@/components/settings/appearance-panel"
import { ClearDataPanel } from "@/components/settings/clear-data-panel"
import { DomainPanel } from "@/components/settings/domain-panel"
import { NotificationsSettingsPanel } from "@/components/settings/notifications-settings-panel"
import { PasswordsPanel } from "@/components/settings/passwords-panel"
import { SessionSecurityPanel } from "@/components/settings/session-security-panel"
import {
  SETTINGS_DEFAULT_TAB,
  SETTINGS_LEGACY_TAB_ROUTES,
  settingsTabFromParam,
  type SettingsTab,
} from "@/components/settings/settings-nav-config"
import { SettingsShell } from "@/components/settings/settings-shell"
import { StorageSettingsForm } from "@/components/settings/storage-settings-form"

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
    const legacy = SETTINGS_LEGACY_TAB_ROUTES[rawTab]
    if (legacy) {
      router.replace(legacy)
    }
  }, [rawTab, router])

  const tab = settingsTabFromParam(rawTab) ?? SETTINGS_DEFAULT_TAB

  const setTab = useCallback(
    (next: SettingsTab) => {
      router.replace(`/settings?tab=${next}`, { scroll: false })
    },
    [router],
  )

  const panels: Record<SettingsTab, ReactNode> = {
    storage: <StorageSettingsForm />,
    domain: <DomainPanel />,
    passwords: <PasswordsPanel />,
    "data-reset": <ClearDataPanel />,
    "access-control": <AccessControlPanel />,
    session: <SessionSecurityPanel />,
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
        subtitle="Instance · security · intelligence · personalization"
        description="Storage, domain, passwords, sessions, access control, API protection, AI planning, and account-level preferences."
        stats={[
          { label: "Instance", value: "2 areas" },
          { label: "Security", value: "5 areas" },
          { label: "Intelligence", value: "2 areas" },
          { label: "Personalization", value: "3 areas" },
        ]}
      />

      <SettingsShell tab={tab} onTabChange={setTab}>
        {panels[tab]}
      </SettingsShell>
    </div>
  )
}
