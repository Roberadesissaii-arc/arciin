"use client"

import type { ReactNode } from "react"

import {
  SETTINGS_GROUP_LABELS,
  SETTINGS_NAV,
  type SettingsTab,
} from "@/components/settings/settings-nav-config"

/**
 * Original settings chrome: theme tokens + settings-nav-active (accent orange).
 * Layout/spacing only — do not override active colors with zinc utilities.
 */
export function SettingsShell({
  tab,
  onTabChange,
  children,
}: {
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:gap-5">
      <div className="shrink-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:sticky lg:top-4 lg:w-60 lg:self-start">
        <nav className="flex gap-1 overflow-x-auto px-2.5 py-2.5 scrollbar-hide lg:block lg:space-y-3 lg:overflow-visible lg:px-2.5 lg:py-3.5">
          {SETTINGS_NAV.map((group, gi) => (
            <div key={SETTINGS_GROUP_LABELS[gi]} className="lg:space-y-0.5">
              <p className="hidden px-3 pb-1.5 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 lg:block">
                {SETTINGS_GROUP_LABELS[gi]}
              </p>
              <div className="flex gap-1 lg:flex-col lg:gap-0.5">
                {group.map(({ id, label, icon: Icon }) => {
                  const active = tab === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onTabChange(id)}
                      className={
                        active
                          ? "settings-nav-active shrink-0 whitespace-nowrap rounded-xl border px-3 py-2.5 text-left text-[12px] font-medium transition-colors lg:w-full"
                          : "shrink-0 whitespace-nowrap rounded-xl border border-transparent px-3 py-2.5 text-left text-[12px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 lg:w-full"
                      }
                    >
                      <span className="flex items-center gap-3">
                        <Icon className="size-4 shrink-0 opacity-90" />
                        {label}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto rounded-2xl border border-border bg-card px-4 py-5 shadow-sm md:px-5 md:py-5 lg:px-7 lg:py-6">
        {children}
      </div>
    </div>
  )
}
