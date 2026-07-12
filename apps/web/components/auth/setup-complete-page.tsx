"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle2, Sparkles } from "lucide-react"

import { MobileAppInstallPanel } from "@/components/settings/mobile-app-install-panel"
import { Button } from "@/components/ui/button"

export function SetupCompletePage() {
  const router = useRouter()

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 pb-10">
      <div className="overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-card to-card p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600">
            <CheckCircle2 className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
              Setup complete
            </p>
            <h1 className="mt-1 font-heading text-2xl font-bold tracking-tight text-foreground">
              Your Arciin instance is ready.
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              The owner account is live, default libraries are in place, and the vault is waiting for
              your files. You can open the dashboard now or add the mobile companion on this server
              first.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => router.push("/dashboard")}
              >
                <Sparkles className="size-4" />
                Go to dashboard
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/integrations">Integrations</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <MobileAppInstallPanel
        variant="welcome"
        showSkip
        onSkip={() => router.push("/dashboard")}
      />
    </div>
  )
}
