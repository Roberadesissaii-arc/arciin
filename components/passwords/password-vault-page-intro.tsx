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
  const description =
    entryCount === 0
      ? "No credentials stored yet. Import from Settings when you are ready — nothing is locked until you add entries."
      : pinConfigured
        ? "Saved credentials stay encrypted on disk. Unlock with your 6-digit PIN to view or copy secrets."
        : lockRequired && !secretsVisible
          ? "Unlock the vault once to browse every entry with the eye icon, or tap the eye on a single row to view that password only."
          : "Vault is unlocked — use the eye on each row to show or hide that password. Lock the vault when you are done."

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
