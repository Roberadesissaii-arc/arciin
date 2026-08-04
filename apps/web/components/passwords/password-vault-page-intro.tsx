"use client"

import Link from "next/link"
import { FingerprintPattern, Lock } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"

export function PasswordVaultPageIntro({
  entryCount,
  loading,
  pinConfigured,
  lockRequired,
  secretsVisible,
}: {
  entryCount: number
  loading?: boolean
  pinConfigured: boolean
  lockRequired: boolean
  secretsVisible: boolean
}) {
  const description =
    entryCount === 0
      ? "No credentials yet — import from Settings when you are ready."
      : pinConfigured
        ? "Credentials are encrypted on this server. Unlock with your PIN to view or copy secrets."
        : lockRequired && !secretsVisible
          ? "Unlock once to browse entries, or use the eye on a single row."
          : "Vault unlocked — use the eye on each row to show or hide passwords."

  return (
    <DashboardPageIntro
      title="Passwords"
      subtitle="Encrypted vault · sidebar access"
      cornerDecoration={<IntroCornerIcon icon={FingerprintPattern} />}
      description={
        <>
          {description}{" "}
          <Link href="/settings?tab=passwords" className="font-medium text-primary hover:underline">
            Import &amp; PIN settings
          </Link>
          .
        </>
      }
      footer={
        entryCount > 0 ? (
          <div className="flex justify-end">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold text-muted-foreground shadow-sm">
              <Lock className="size-3.5 text-primary" />
              {loading ? "…" : `${entryCount} saved`}
            </span>
          </div>
        ) : undefined
      }
    />
  )
}
