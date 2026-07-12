import Link from "next/link"
import { Lock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PlanBadge } from "@/components/license/plan-badge"
import { cn } from "@/lib/utils"

export function LockedFeatureCard({
  plan,
  title,
  description,
  className,
}: {
  plan: string
  title: string
  description?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-2xl border border-dashed border-border bg-muted/20 p-5",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Lock className="size-4 text-[color:var(--arciin-accent,#FF4F12)]" />
        <PlanBadge plan={plan} />
      </div>
      <h3 className="mt-3 text-[15px] font-semibold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1.5 flex-1 text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      <Button
        asChild
        size="sm"
        className="mt-4 w-fit bg-[color:var(--arciin-accent,#FF4F12)] text-white hover:bg-[color:var(--arciin-accent,#FF4F12)]/90"
      >
        <Link href="/settings?tab=license">Unlock with {plan}</Link>
      </Button>
    </div>
  )
}
