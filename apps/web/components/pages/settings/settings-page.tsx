"use client"

import { useCallback, useEffect, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Settings2 } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { AccessibilityPanel } from "@/components/settings/accessibility-panel"
import { AiPanel } from "@/components/settings/ai-panel"
import { AiSecurityPanel } from "@/components/settings/ai-security-panel"
import { AccessControlPanel } from "@/components/settings/access-control-panel"
import { ApiProtectionPanel } from "@/components/settings/api-protection-panel"
import { AppearancePanel } from "@/components/settings/appearance-panel"
import { AttachedDisksPanel } from "@/components/settings/attached-disks-panel"
import { ClearDataPanel } from "@/components/settings/clear-data-panel"
import { DomainPanel } from "@/components/settings/domain-panel"
import { DiscordPanel } from "@/components/settings/discord-panel"
import { EmailPanel } from "@/components/settings/email-panel"
import { LicensePanel } from "@/components/settings/license-panel"
import { NotificationsSettingsPanel } from "@/components/settings/notifications-settings-panel"
import { PasswordsPanel } from "@/components/settings/passwords-panel"
import { SessionSecurityPanel } from "@/components/settings/session-security-panel"
import {
  SETTINGS_DEFAULT_TAB,
  SETTINGS_LEGACY_TAB_ROUTES,
  settingsIntroStats,
  settingsTabFromParam,
  type SettingsTab,
} from "@/components/settings/settings-nav-config"
import { SettingsShell } from "@/components/settings/settings-shell"
import { StorageSettingsForm } from "@/components/settings/storage-settings-form"
import { TrashPanel } from "@/components/settings/trash-panel"
import { UpdatesPanel } from "@/components/settings/updates-panel"

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
      const params = new URLSearchParams(searchParams.toString())
      params.set("tab", next)
      if (next !== "appearance") {
        params.delete("section")
      }
      router.replace(`/settings?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const panels: Record<SettingsTab, ReactNode> = {
    storage: <StorageSettingsForm />,
    "attached-disks": <AttachedDisksPanel />,
    domain: <DomainPanel />,
    email: (
      <div className="space-y-4">
        <EmailPanel />
        <DiscordPanel />
      </div>
    ),
    license: <LicensePanel />,
    updates: <UpdatesPanel />,
    passwords: <PasswordsPanel />,
    trash: <TrashPanel />,
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
        cornerDecoration={<IntroCornerIcon icon={Settings2} />}
        description="Storage, domain, license, passwords, trash, devices, sessions, access control, API protection, AI planning, and account-level preferences."
        stats={settingsIntroStats()}
        statsGridClassName="grid-cols-2 xl:grid-cols-4"
      />

      <SettingsShell tab={tab} onTabChange={setTab}>
        {panels[tab]}
      </SettingsShell>
    </div>
  )
}
