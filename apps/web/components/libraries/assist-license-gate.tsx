"use client"

import { LockedFeatureCard } from "@/components/license/locked-feature-card"
import { useLicense } from "@/lib/license/use-license"

/** Same Pro gate as AI Chat in the sidebar. */
export const ASSIST_LICENSE_FEATURE = "ai.chat" as const

/**
 * Whether Assist (video / document AI tools) should show a paywall.
 *
 * Uses `shouldPaywall` so we never flash a lock for Pro while the licence is
 * still loading — same rule as the sidebar Pro badges.
 */
export function useAssistLicense() {
  const license = useLicense()
  const locked = license.shouldPaywall(ASSIST_LICENSE_FEATURE)
  const plan = license.requiredPlanFor(ASSIST_LICENSE_FEATURE)
  const planLabel = plan ? license.planLabel(plan) : "Pro"
  return { locked, planLabel, license }
}

/** Full-panel lock when Assist is opened without Pro. */
export function AssistLockedPanel({ className }: { className?: string }) {
  const { planLabel } = useAssistLicense()
  return (
    <div className={className ?? "flex min-h-0 flex-1 flex-col p-3"} data-testid="assist-locked">
      <LockedFeatureCard
        plan={planLabel}
        title="Assist is a Pro feature"
        description="Transcript, titles, summarize, and document AI tools unlock with Pro — the same plan as AI Chat."
        className="flex-1"
      />
    </div>
  )
}
