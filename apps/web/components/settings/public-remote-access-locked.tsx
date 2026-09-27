import Link from "next/link"
import { Globe, Lock } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { PublicRemoteAccessEntitlement } from "@/lib/types/models"

/** True only when the server says the plan excludes public Remote Access. */
export function isPublicRemoteAccessLocked(entitlement: PublicRemoteAccessEntitlement | undefined): boolean {
  return entitlement ? !entitlement.entitled : false
}

function planList(plans: string[]): string {
  const names = plans.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
  if (names.length <= 1) return names.join("")
  return `${names.slice(0, -1).join(", ")}, or ${names.at(-1)}`
}

/**
 * What a plan without public Remote Access sees in place of the tunnel controls.
 *
 * The page used to show a live-looking public address and a Generate URL button
 * on Free, and the button then answered "requires a higher plan". One compact
 * card says the same thing before anything is clicked; LAN addresses elsewhere
 * on the page are untouched.
 */
export function PublicRemoteAccessLockedCard({ entitlement }: { entitlement: PublicRemoteAccessEntitlement }) {
  const plans = entitlement.requiredPlans.length ? entitlement.requiredPlans : ["pro", "team", "business"]
  return (
    <section
      className="overflow-hidden rounded-2xl border border-border bg-card"
      data-testid="public-remote-access-locked"
    >
      <div className="flex flex-wrap items-start gap-3 px-4 py-4 sm:px-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/25">
          <Globe className="size-5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
            Public Remote Access
            <Lock className="size-3.5 text-muted-foreground" aria-hidden />
          </h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Available with {planList(plans)}. Your server stays reachable on your own network.
          </p>
        </div>
        <Button size="sm" variant="outline" asChild>
          <Link href="/settings?tab=license">View plans</Link>
        </Button>
      </div>
    </section>
  )
}
