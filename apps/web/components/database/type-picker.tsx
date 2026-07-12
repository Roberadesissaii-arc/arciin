"use client"

import { useMemo, useState } from "react"
import { ChevronDown, Search } from "lucide-react"

import { PG_GROUPS, PG_TYPES } from "@/lib/database/pg-types"
import { cn } from "@/lib/utils"

export function TypePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return PG_TYPES.filter(
      (t) => t.value.includes(q) || t.label.toLowerCase().includes(q),
    )
  }, [search])

  const selected = PG_TYPES.find((t) => t.value === value) ?? PG_TYPES[0]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center gap-2 rounded-xl border border-input bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted/40"
      >
        <span className="w-6 shrink-0 text-center font-mono text-[11px] font-bold text-muted-foreground">
          {selected.icon}
        </span>
        <span className="flex-1 text-left font-mono text-[13px]">{selected.value}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search types…"
              className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>

          {/* Type list */}
          <div className="max-h-[280px] overflow-y-auto py-1">
            {PG_GROUPS.map((group) => {
              const items = filtered.filter((t) => t.group === group)
              if (!items.length) return null
              return (
                <div key={group}>
                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
                    {group}
                  </p>
                  {items.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => {
                        onChange(t.value)
                        setOpen(false)
                        setSearch("")
                      }}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground",
                        value === t.value && "bg-primary/15",
                      )}
                    >
                      <span className="w-5 shrink-0 text-center font-mono text-[11px] font-bold text-emerald-600">
                        {t.icon}
                      </span>
                      <span className="font-mono text-[13px] font-semibold text-foreground">{t.value}</span>
                      <span className="flex-1 truncate text-[12px] text-muted-foreground">{t.label}</span>
                      {value === t.value && (
                        <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                      )}
                    </button>
                  ))}
                </div>
              )
            })}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-[12px] text-muted-foreground">No types match.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
