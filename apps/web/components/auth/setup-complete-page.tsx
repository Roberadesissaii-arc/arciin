"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle2, LayoutDashboard, Sparkles } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { MobileAppInstallPanel } from "@/components/settings/mobile-app-install-panel"
import { Button } from "@/components/ui/button"

/**
 * Post-claim welcome — full-width dashboard page content (not a floating center card).
 * Lives under the authenticated dashboard shell like Integrations / Settings.
 */
export function SetupCompletePage() {
  const router = useRouter()

  return (
    <div className="space-y-6 pb-6">
      <DashboardPageIntro
        title="Setup complete"
        subtitle="Your Arciin instance is ready"
        cornerDecoration={<IntroCornerIcon icon={CheckCircle2} />}
        className="border-emerald-200/70 bg-gradient-to-br from-white via-emerald-50/30 to-[#fff8f5]/70"
        description="The owner account is live, default libraries are in place, and storage is ready for your files. Open the dashboard, or optionally add the phone companion on this same machine."
        stats={[
          { label: "Owner", value: "Ready" },
          { label: "Libraries", value: "Created" },
          { label: "Setup", value: "Locked" },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => router.push("/dashboard")}
            >
              <Sparkles className="size-4" />
              Go to dashboard
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link href="/integrations">
                <LayoutDashboard className="size-4" />
                Integrations
              </Link>
            </Button>
          </div>
        }
      />

      <section className="space-y-3" aria-labelledby="setup-complete-mobile">
        <div className="space-y-0.5 border-l-2 border-primary pl-3">
          <h2
            id="setup-complete-mobile"
            className="font-heading text-base font-semibold tracking-tight text-zinc-900"
          >
            Optional · Arciin Mobile
          </h2>
          <p className="text-sm text-zinc-600">
            Install the phone PWA on this server later if you want — desktop works without it.
          </p>
        </div>
        <MobileAppInstallPanel
          variant="welcome"
          showSkip
          onSkip={() => router.push("/dashboard")}
        />
      </section>
    </div>
  )
}
