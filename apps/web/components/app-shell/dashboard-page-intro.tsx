import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

export type DashboardIntroStat = { label: string; value: ReactNode }

/**
 * Shared light “hero” for dashboard pages (matches Database / Activity styling).
 */
export function DashboardPageIntro({
  title,
  subtitle,
  description,
  stats,
  footer,
  badge,
  actions,
  statsGridClassName,
  className,
  cornerDecoration,
}: {
  title: string
  subtitle?: ReactNode
  description: ReactNode
  stats?: DashboardIntroStat[]
  /** Rich content below description (e.g. detailed stat cards). Renders instead of `stats` when set. */
  footer?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  /** Optional override for stat grid columns (default: 2 cols sm, 4 on lg when ≥4 stats). */
  statsGridClassName?: string
  className?: string
  /** Decorative element clipped at the top-right (e.g. oversized icon). */
  cornerDecoration?: ReactNode
}) {
  const n = stats?.length ?? 0
  const defaultStatsGrid =
    n >= 4
      ? "sm:grid-cols-2 lg:grid-cols-4"
      : n === 3
        ? "sm:grid-cols-2 lg:grid-cols-3"
        : "sm:grid-cols-2"

  return (
    <div
      className={cn(
        // overflow-x only — vertical overflow:hidden was clipping the description
        // when a parent flex layout squeezed this card.
        "relative shrink-0 overflow-x-hidden rounded-3xl border border-zinc-200/90 bg-gradient-to-br from-zinc-50 via-white to-zinc-50/95 p-5 shadow-sm ring-1 ring-inset ring-zinc-200/60 md:p-6 lg:p-7",
        cornerDecoration && "pr-10 sm:pr-14",
        className,
      )}
    >
      {cornerDecoration}

      <div
        className="pointer-events-none absolute inset-0 opacity-100"
        aria-hidden
        style={{
          background: cornerDecoration
            ? "radial-gradient(ellipse 55% 70% at 100% 0%, color-mix(in srgb, var(--arciin-accent, #ff4f12) 11%, transparent) 0%, transparent 58%)"
            : "radial-gradient(ellipse 70% 55% at 50% -15%, color-mix(in srgb, var(--arciin-accent, #ff4f12) 10%, transparent) 0%, transparent 52%)",
        }}
      />

      <div className="relative space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <h2 className="font-heading text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">
              {title}
              <span className="text-primary">.</span>
            </h2>
            {subtitle ? (
              <div className="text-sm font-medium text-zinc-600">{subtitle}</div>
            ) : null}
          </div>
          {(badge || actions) ? (
            <div className="relative z-10 flex shrink-0 flex-wrap items-center justify-end gap-2">
              {badge}
              {actions}
            </div>
          ) : null}
        </div>

        <div className="relative z-10 max-w-2xl text-sm leading-relaxed text-zinc-700">
          {description}
        </div>

        {footer ? (
          <div className="border-t border-zinc-200/80 pt-4">{footer}</div>
        ) : stats && stats.length > 0 ? (
          <div
            className={cn(
              "grid gap-3 border-t border-zinc-200/80 pt-4",
              statsGridClassName ?? defaultStatsGrid
            )}
          >
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-2xl border border-zinc-200/80 bg-white/70 px-3 py-2.5 shadow-sm ring-1 ring-black/[0.03] backdrop-blur-sm"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  {s.label}
                </p>
                <p className="mt-1 break-words text-lg font-semibold tabular-nums text-zinc-900">
                  {s.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
