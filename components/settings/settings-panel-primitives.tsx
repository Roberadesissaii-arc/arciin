"use client"

import { CardDescription, CardTitle } from "@/components/ui/card"

export function PillSwitch({
  on,
  onChange,
  disabled,
}: {
  on: boolean
  onChange: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onChange}
      disabled={disabled}
      className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--arciin-accent,#FF4F12)_50%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
      style={{ background: on ? "var(--arciin-accent, #FF4F12)" : "#d4d4d8" }}
    >
      <span
        className="pointer-events-none inline-block size-3.5 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: on ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  )
}

export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border py-3.5 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] text-zinc-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <CardTitle className="text-foreground">{title}</CardTitle>
      </div>
      <CardDescription className="text-zinc-500">{description}</CardDescription>
    </div>
  )
}
