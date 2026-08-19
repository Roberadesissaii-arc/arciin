import type { ReactNode } from "react"
import Link from "next/link"
import { Lock } from "lucide-react"

import { PlanBadge } from "@/components/license/plan-badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { pricingUrl } from "@/lib/license/upgrade-url"

/**
 * Floating empty-state lock copy with real buttons (not underlined HTML links).
 */
export function SoftLockBanner({
  plan,
  title,
  description,
  className,
  actions,
}: {
  plan: string
  title: string
  description?: string
  className?: string
  /** Replace the default Activate/Manage buttons (e.g. chat's Test model / Upgrade / Back). */
  actions?: ReactNode
}) {
  return (
    <div className={cn("flex flex-col items-center text-center", className)}>
      <Lock
        className="size-12 text-[color-mix(in_srgb,var(--arciin-accent,#FF4F12)_45%,transparent)]"
        strokeWidth={1.5}
        aria-hidden
      />
      {/* Badge first as a label, then one title — avoids “two titles” (title + Pro). */}
      <div className="mt-4 flex flex-col items-center gap-2">
        <PlanBadge plan={plan} />
        <p className="text-base font-semibold tracking-tight text-foreground sm:text-[17px]">
          {title}
        </p>
      </div>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted-foreground">
        {description ??
          `Activate a ${plan} license to use this feature. Your files stay on this server either way.`}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {actions ?? (
          <>
            <Button
              asChild
              size="sm"
              className="bg-[color:var(--arciin-accent,#FF4F12)] text-white hover:bg-[color:var(--arciin-accent,#FF4F12)]/90"
            >
              <Link href="/settings?tab=license">Activate license</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={pricingUrl()} target="_blank" rel="noreferrer">
                View plans
              </a>
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
