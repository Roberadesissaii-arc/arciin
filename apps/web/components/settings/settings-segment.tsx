"use client"

import { cn } from "@/lib/utils"

export type SegmentOption<T extends string | number> = {
  label: string
  value: T
}

export function SettingsSegment<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  "aria-label"?: string
}) {
  return (
    <div
      className="inline-flex flex-wrap gap-0.5 rounded-xl border border-border bg-muted/50 p-1 shadow-sm"
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
              active
                ? "bg-primary/15 text-primary shadow-sm ring-1 ring-primary/35"
                : "text-zinc-600 hover:bg-white/80 hover:text-zinc-900",
              disabled && "pointer-events-none opacity-40",
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
