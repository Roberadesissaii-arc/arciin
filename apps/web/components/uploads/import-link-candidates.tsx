"use client"

import { useState } from "react"
import { FileText, Film, Image as ImageIcon, Music2, Package, type LucideIcon } from "lucide-react"

import type { ImportCandidate, ImportCandidateCategory } from "@arciin/shared"

import { Checkbox } from "@/components/ui/checkbox"
import { importCandidateThumbnailUrl } from "@/lib/api/imports"
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
 * A candidate's preview: the server-proxied thumbnail (same origin — the
 * third-party URL never reaches the browser, and a viewer's address is never
 * sent to the page's image host), or the category icon when there is none or
 * it fails. Never a broken-image glyph.
 */
export function ImportCandidateThumb({
  inspectionId,
  item,
  className,
}: {
  inspectionId: string
  item: Pick<ImportCandidate, "id" | "category" | "hasThumbnail">
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const Icon = CATEGORY_ICON[item.category] ?? Package
  return (
    <span
      className={cn(
        "relative flex aspect-video w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200/80 bg-zinc-100 text-zinc-500",
        className,
      )}
      data-testid="import-candidate-thumb"
    >
      {item.hasThumbnail && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin proxied preview
        <img
          src={importCandidateThumbnailUrl(inspectionId, item.id)}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon className="size-4" aria-hidden />
      )}
    </span>
  )
}

/** The media found on a page or in a playlist — at most five rows, each with a checkbox. */
export function ImportLinkCandidates({
  inspectionId,
  title,
  items,
  selected,
  onToggle,
  onToggleAll,
  disabled,
}: {
  inspectionId: string
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
      <ul>
        {items.map((item) => {
          const checked = selected.has(item.id)
          const duration = formatCandidateDuration(item.durationSeconds)
          const inputId = `import-candidate-${item.id}`
          return (
            <li key={item.id} className="border-b border-zinc-100 last:border-b-0">
              <label
                htmlFor={inputId}
                data-selected={checked || undefined}
                className={cn(
                  "flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors motion-reduce:transition-none",
                  checked ? "bg-[#FF4F12]/[0.04]" : "hover:bg-zinc-50",
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
                <ImportCandidateThumb
                  inspectionId={inspectionId}
                  item={item}
                  className={checked ? "ring-2 ring-[#FF4F12]/35 ring-offset-1" : undefined}
                />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[12.5px] font-medium leading-snug text-foreground">{item.title}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-zinc-600">
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

/** One inspected item: its own title and preview, before importing it. */
export function ImportLinkSingleItem({ inspectionId, item }: { inspectionId: string; item: ImportCandidate }) {
  const duration = formatCandidateDuration(item.durationSeconds)
  return (
    <section
      className="flex min-w-0 items-center gap-3 rounded-xl border border-zinc-200/90 bg-white p-2.5"
      aria-label="Media found at this link"
      data-testid="import-single-item"
    >
      <ImportCandidateThumb inspectionId={inspectionId} item={item} className="w-[112px] rounded-[10px]" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-zinc-900">{item.title}</p>
        <p className="mt-0.5 truncate text-[11.5px] text-zinc-600">
          {[item.source, duration].filter(Boolean).join(" · ")}
        </p>
      </div>
    </section>
  )
}
