"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

export type FilterDropdownOption = {
  value: string
  label: string
  /** Optional color dot (e.g. badge filter). */
  color?: string
  /** Nested under a parent option, e.g. a specific computer. */
  indent?: boolean
}

/**
 * Custom filter dropdown for library toolbars (not a native &lt;select&gt;).
 * White trigger, orange open ring, check on selected option.
 */
export function FilterDropdown({
  value,
  onValueChange,
  options,
  minWidthClass = "min-w-[9.5rem]",
  ariaLabel,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  options: FilterDropdownOption[]
  minWidthClass?: string
  ariaLabel: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const selected = options.find((o) => o.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointer)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onPointer)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn("relative", minWidthClass, className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative h-[46px] w-full rounded-xl border border-zinc-200 bg-white pl-3 pr-8",
          "text-left text-[13px] font-medium text-zinc-700 transition-colors",
          "hover:border-zinc-300 hover:bg-zinc-50",
          open &&
            "border-[rgba(255,79,18,0.45)] ring-2 ring-[rgba(255,79,18,0.15)]",
        )}
        data-testid="source-filter"
      >
        <span className="flex min-w-0 items-center gap-2 truncate">
          {selected?.color ? (
            <span
              className="size-2.5 shrink-0 rounded-full ring-1 ring-black/10"
              style={{ backgroundColor: selected.color }}
              aria-hidden
            />
          ) : null}
          <span className="truncate">{selected?.label ?? "—"}</span>
        </span>
        <ChevronDown
          className={cn(
            "pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400 transition-transform",
            open && "rotate-180 text-[#FF4F12]",
          )}
          aria-hidden
        />
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className={cn(
            "absolute right-0 z-50 mt-1.5 min-w-full overflow-hidden rounded-xl border border-zinc-200 bg-white py-1",
            "ring-1 ring-black/[0.04]",
          )}
          style={{ boxShadow: "0 16px 40px -18px rgba(0,0,0,0.28)" }}
        >
          {options.map((option) => {
            const isSelected = option.value === value
            return (
              <li key={option.value} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  data-source-value={option.value}
                  className={cn(
                    "flex w-full items-center gap-2 py-2 text-left text-[13px] font-medium transition-colors",
                    option.indent ? "pl-7 pr-3" : "px-3",
                    isSelected
                      ? "bg-[color-mix(in_srgb,#FF4F12_10%,transparent)] text-[#FF4F12]"
                      : "text-zinc-700 hover:bg-zinc-50",
                  )}
                  style={
                    isSelected
                      ? { backgroundColor: "color-mix(in srgb, #FF4F12 10%, transparent)" }
                      : undefined
                  }
                  onClick={() => {
                    onValueChange(option.value)
                    setOpen(false)
                  }}
                >
                  {option.color ? (
                    <span
                      className="size-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: option.color }}
                      aria-hidden
                    />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {isSelected ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
