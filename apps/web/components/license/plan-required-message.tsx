import Link from "next/link"
import { Lock, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PlanBadge } from "@/components/license/plan-badge"
import { checkoutUrl, pricingUrl, websiteHostLabel } from "@/lib/license/upgrade-url"

export function PlanRequiredMessage({
  plan,
  featureLabel,
}: {
  plan: string
  featureLabel: string
}) {
  const planSlug = plan.toLowerCase()
  const checkout =
    planSlug === "pro" || planSlug === "team" || planSlug === "business"
      ? checkoutUrl(planSlug)
      : pricingUrl()

  return (
    <div className="flex min-h-[min(70vh,560px)] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border border-[color-mix(in_srgb,var(--arciin-accent,#FF4F12)_30%,transparent)] bg-[color-mix(in_srgb,var(--arciin-accent,#FF4F12)_10%,transparent)]">
        <Lock className="size-6 text-[color:var(--arciin-accent,#FF4F12)]" />
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
          Unlock {featureLabel}
        </h2>
        <PlanBadge plan={plan} />
      </div>

      <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
        This feature is part of the <span className="font-semibold text-foreground">{plan}</span>{" "}
        plan. Activate a license on this server to use it — or keep using Free for files, libraries,
        and uploads. Your data stays on your hardware either way.
      </p>

      <ul className="mt-5 max-w-md space-y-2 text-left text-[13px] text-muted-foreground">
        <li className="flex gap-2">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[color:var(--arciin-accent,#FF4F12)]" />
          Free core never locks your files, downloads, or local storage.
        </li>
        <li className="flex gap-2">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[color:var(--arciin-accent,#FF4F12)]" />
          Paid plans unlock AI Chat, Assist, vault, automation, and team tools.
        </li>
        <li className="flex gap-2">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-[color:var(--arciin-accent,#FF4F12)]" />
          Get a license on {websiteHostLabel()}, then paste the key under Settings →
          License.
        </li>
      </ul>

      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/settings?tab=license">Activate license</Link>
        </Button>
        <Button asChild variant="outline">
          <a href={checkout} target="_blank" rel="noreferrer">
            View {plan} on {websiteHostLabel()}
          </a>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/dashboard">Back to overview</Link>
        </Button>
      </div>
    </div>
  )
}
