"use client"

import { useEffect } from "react"
import Link from "next/link"
import { ExternalLink, KeyRound } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { Button } from "@/components/ui/button"

const ACCOUNT_URL =
  process.env.NEXT_PUBLIC_ARCIIN_ACCOUNT_URL || "http://localhost:3010/account"

/**
 * Legacy demo portal — redirects users to the real account dashboard prototype.
 * Kept as a soft landing so old bookmarks still work.
 */
export default function DemoLicensesPage() {
  useEffect(() => {
    const t = window.setTimeout(() => {
      window.location.href = ACCOUNT_URL
    }, 1200)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="space-y-6 pb-10">
      <DashboardPageIntro
        title="License portal moved"
        subtitle="Use Arciin Account"
        cornerDecoration={<IntroCornerIcon icon={KeyRound} />}
        description="Demo license creation now lives in the Arciin account dashboard prototype (future account.arciin.com), connected to the hosted license server."
      />

      <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <p className="text-[14px] text-muted-foreground">
          Redirecting to the account dashboard…
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <a href={ACCOUNT_URL} target="_blank" rel="noreferrer">
              <ExternalLink className="size-3.5" />
              Open Arciin account
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link href="/settings?tab=license">Settings → License</Link>
          </Button>
        </div>
        <p className="mt-4 text-[12px] text-muted-foreground">
          Run <code className="text-foreground">pnpm account</code> and{" "}
          <code className="text-foreground">pnpm license-server</code> if the portal is offline.
        </p>
      </div>
    </div>
  )
}
