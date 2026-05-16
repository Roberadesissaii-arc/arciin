"use client"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import Link from "next/link"

export function PasswordVaultPageIntro({
  entryCount,
  statusLabel,
  loading,
  pinConfigured,
  lockRequired,
  secretsVisible,
  actions,
}: {
  entryCount: number
  statusLabel: string
  loading?: boolean
  pinConfigured: boolean
  lockRequired: boolean
  secretsVisible: boolean
  actions?: React.ReactNode
}) {
  const description = pinConfigured
    ? "Saved credentials stay encrypted on disk. Unlock with your 6-digit PIN to view or copy secrets."
    : lockRequired && !secretsVisible
      ? "Unlock the vault to view credentials. Set a PIN under Settings → Passwords for quicker access."
      : "Import from Settings, then manage logins here. Passwords stay masked until you reveal them."

  return (
    <DashboardPageIntro
      title="Passwords"
      subtitle="Encrypted vault · sidebar access"
      description={
        <>
          {description}{" "}
          <Link href="/settings?tab=passwords" className="font-medium text-primary hover:underline">
            Import &amp; PIN settings
          </Link>
          .
        </>
      }
      stats={[
        { label: "Entries", value: loading ? "…" : String(entryCount) },
        { label: "Status", value: statusLabel },
      ]}
      actions={actions}
    />
  )
}
