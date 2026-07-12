import { Building2, Crown, Users } from "lucide-react"

/** Tier badge — Free is quiet, paid tiers get an icon and color so the plan is obvious at a glance. */
export function PlanBadge({ plan }: { plan: string }) {
  const tier = plan.toLowerCase()
  if (tier === "pro") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white"
        style={{
          background:
            "linear-gradient(to right, var(--arciin-accent, #ff4f12), var(--arciin-accent-hover, #ff6a33))",
          boxShadow:
            "0 4px 12px -4px color-mix(in srgb, var(--arciin-accent, #ff4f12) 50%, transparent)",
        }}
      >
        <Crown className="size-3" aria-hidden />
        Pro
      </span>
    )
  }
  if (tier === "team") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-[0_4px_12px_-4px_rgba(124,58,237,0.5)]">
        <Users className="size-3" aria-hidden />
        Team
      </span>
    )
  }
  if (tier === "business") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
        <Building2 className="size-3" aria-hidden />
        Business
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600">
      Free
    </span>
  )
}
