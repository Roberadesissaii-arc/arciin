"use client"

import { useMemo, useState } from "react"
import { Copy, FileWarning, RefreshCw, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { DuplicateConflict } from "@/lib/stores/upload-store"

type Resolution = DuplicateConflict["resolution"]

const RESOLUTIONS: { value: NonNullable<Resolution>; label: string }[] = [
  { value: "replace", label: "Replace" },
  { value: "keep-both", label: "Keep both" },
  { value: "skip", label: "Skip" },
]

function ResolutionButton({
  value,
  selected,
  onClick,
}: {
  value: NonNullable<Resolution>
  selected: boolean
  onClick: () => void
}) {
  const cfg = RESOLUTIONS.find((r) => r.value === value)!
  const Icon = value === "replace" ? RefreshCw : value === "keep-both" ? Copy : X
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center transition-colors",
        selected
          ? "border-primary/40 bg-[var(--arciin-accent-soft,#fff7ed)] text-primary"
          : "border-border bg-white text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="text-[11px] font-semibold leading-none">{cfg.label}</span>
    </button>
  )
}

type FilenameGroup = {
  filename: string
  items: DuplicateConflict[]
}

export function DuplicateResolutionDialog({
  conflicts,
  onResolve,
  onCancel,
}: {
  conflicts: DuplicateConflict[]
  onResolve: (resolved: DuplicateConflict[]) => void
  onCancel: () => void
}) {
  const groups = useMemo(() => {
    const map = new Map<string, DuplicateConflict[]>()
    for (const c of conflicts) {
      const list = map.get(c.file.name) ?? []
      list.push(c)
      map.set(c.file.name, list)
    }
    return Array.from(map.entries()).map(
      ([filename, items]): FilenameGroup => ({ filename, items }),
    )
  }, [conflicts])

  const [resolutions, setResolutions] = useState<Record<string, NonNullable<Resolution>>>(() => {
    const init: Record<string, NonNullable<Resolution>> = {}
    for (const g of groups) {
      init[g.filename] = "keep-both"
    }
    return init
  })

  function setAll(res: NonNullable<Resolution>) {
    const next: Record<string, NonNullable<Resolution>> = {}
    for (const g of groups) {
      next[g.filename] = res
    }
    setResolutions(next)
  }

  function setOne(filename: string, res: NonNullable<Resolution>) {
    setResolutions((prev) => ({ ...prev, [filename]: res }))
  }

  function handleConfirm() {
    const resolved = conflicts.map((c) => ({
      ...c,
      resolution: resolutions[c.file.name] ?? "keep-both",
    }))
    onResolve(resolved)
  }

  const allSame = new Set(Object.values(resolutions)).size === 1
    ? (Object.values(resolutions)[0] as NonNullable<Resolution>)
    : null

  const totalCopies = conflicts.length
  const uniqueNames = groups.length

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-dialog-title"
    >
      <div className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl ring-1 ring-zinc-200/60">
        <div className="flex items-start gap-3 border-b border-border bg-gradient-to-b from-[var(--arciin-accent-soft,#fff7ed)] to-card px-5 py-4">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-white text-primary shadow-sm">
            <FileWarning className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p id="duplicate-dialog-title" className="text-sm font-semibold text-foreground">
              {uniqueNames === 1 ? "File already in this library" : "Files already in this library"}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {totalCopies === 1
                ? "Choose whether to replace the existing file, skip, or keep both with a new name."
                : `${totalCopies} uploads match ${uniqueNames} existing name${uniqueNames === 1 ? "" : "s"}. Pick one action per name.`}
            </p>
          </div>
        </div>

        {groups.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border bg-zinc-50/90 px-5 py-2.5">
            <span className="text-[11px] font-medium text-muted-foreground">Apply to all</span>
            {RESOLUTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => setAll(r.value)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors",
                  allSame === r.value
                    ? "border-primary/35 bg-[var(--arciin-accent-soft,#fff7ed)] text-primary"
                    : "border-border bg-white text-zinc-600 hover:bg-zinc-50",
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        )}

        <div className="max-h-64 overflow-y-auto bg-white">
          {groups.map((group) => {
            const selected = resolutions[group.filename] ?? "keep-both"
            const count = group.items.length
            return (
              <div
                key={group.filename}
                className="flex flex-col gap-2 border-b border-border px-5 py-3 last:border-b-0"
              >
                <p className="truncate text-xs font-medium text-foreground" title={group.filename}>
                  {group.filename}
                  {count > 1 ? (
                    <span className="ml-1.5 font-normal text-muted-foreground">({count} copies)</span>
                  ) : null}
                </p>
                <div className="flex gap-2">
                  {RESOLUTIONS.map((r) => (
                    <ResolutionButton
                      key={r.value}
                      value={r.value}
                      selected={selected === r.value}
                      onClick={() => setOne(group.filename, r.value)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-zinc-50/80 px-5 py-4">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleConfirm}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}
