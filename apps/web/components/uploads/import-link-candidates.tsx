"use client"

import { FileText, Film, Image as ImageIcon, Music2, Package, type LucideIcon } from "lucide-react"

import type { ImportCandidate, ImportCandidateCategory } from "@arciin/shared"

import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

const CATEGORY_ICON: Record<ImportCandidateCategory, LucideIcon> = {
  video: Film,
  audio: Music2,
  image: ImageIcon,
  document: FileText,
  file: Package,
}

export function formatCandidateDuration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`
}

/**
 * The media found on a page or in a playlist — at most five rows, each with a
 * checkbox. Thumbnails are not loaded from the third-party site (the app's
 * image policy is same-origin, and a viewer's address should not go to every
 * host a page links); a category icon stands in.
 */
export function ImportLinkCandidates({
  title,
  items,
  selected,
  onToggle,
  onToggleAll,
  disabled,
}: {
  title: string | null
  items: ImportCandidate[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  disabled?: boolean
}) {
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id))
  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-white"
      aria-label="Media found at this link"
      data-testid="import-candidates"
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200/80 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-foreground">
            {items.length} items found
          </p>
          {title ? <p className="truncate text-[11px] text-muted-foreground">{title}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] tabular-nums text-muted-foreground" data-testid="import-candidates-count">
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={onToggleAll}
            disabled={disabled}
            className="rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold text-primary hover:bg-primary/5 disabled:opacity-50"
          >
            {allSelected ? "Clear" : "Select all"}
          </button>
        </div>
      </div>
      <ul className="max-h-[15.5rem] overflow-y-auto">
        {items.map((item) => {
          const Icon = CATEGORY_ICON[item.category] ?? Package
          const checked = selected.has(item.id)
          const duration = formatCandidateDuration(item.durationSeconds)
          const inputId = `import-candidate-${item.id}`
          return (
            <li key={item.id} className="border-b border-zinc-100 last:border-b-0">
              <label
                htmlFor={inputId}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 px-3 py-2 transition-colors",
                  checked ? "bg-primary/[0.04]" : "hover:bg-zinc-50",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <Checkbox
                  id={inputId}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => onToggle(item.id)}
                  aria-label={`Import ${item.title}`}
                />
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-foreground">{item.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {[item.source, duration].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
