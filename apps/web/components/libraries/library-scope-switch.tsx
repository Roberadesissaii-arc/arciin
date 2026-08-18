"use client"

import { FolderTree, Layers } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Which slice of a library the asset list is showing.
 *
 * "root" is the default: files already filed into a folder belong in that
 * folder, not still listed at the library root. "all" is the flat dump —
 * every visible asset including folder contents — for when someone wants it.
 */
export type LibraryAssetScope = "all" | "root"

const OPTIONS: Array<{
  value: LibraryAssetScope
  label: string
  hint: string
  icon: typeof Layers
}> = [
  {
    value: "root",
    label: "Root only",
    hint: "Only files sitting directly in the library, not inside a folder",
    icon: FolderTree,
  },
  {
    value: "all",
    label: "All files",
    hint: "Every file in this library, including files inside folders",
    icon: Layers,
  },
]

export function LibraryScopeSwitch({
  scope,
  onScopeChange,
  loadedCount,
  matchingTotal,
  className,
}: {
  scope: LibraryAssetScope
  onScopeChange: (scope: LibraryAssetScope) => void
  /** Rows loaded so far across every fetched page. */
  loadedCount?: number
  /** Every row matching the current filters, from the server. */
  matchingTotal?: number
  className?: string
}) {
  const partiallyLoaded =
    typeof loadedCount === "number" &&
    typeof matchingTotal === "number" &&
    loadedCount < matchingTotal
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      <div
        role="group"
        aria-label="Library file scope"
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-1"
      >
        {OPTIONS.map((option) => {
          const Icon = option.icon
          const active = scope === option.value
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onScopeChange(option.value)}
              aria-pressed={active}
              title={option.hint}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {option.label}
            </button>
          )
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        {scope === "all" ? (
          partiallyLoaded ? (
            <>
              <span className="font-semibold text-foreground">All files</span> in this
              library, including files inside folders —{" "}
              <span className="font-semibold text-foreground">{loadedCount}</span> of{" "}
              <span className="font-semibold text-foreground">{matchingTotal}</span> loaded.
              Use Load more to reach the rest.
            </>
          ) : (
            <>
              Showing <span className="font-semibold text-foreground">all files</span> in this
              library, including files inside folders
              {typeof matchingTotal === "number" ? (
                <>
                  {" "}
                  — <span className="font-semibold text-foreground">{matchingTotal}</span>{" "}
                  {matchingTotal === 1 ? "file" : "files"}
                </>
              ) : null}
              .
            </>
          )
        ) : (
          <>
            Showing <span className="font-semibold text-foreground">root files only</span>.
            Files inside folders are hidden — switch to All files to see everything.
          </>
        )}
      </p>
    </div>
  )
}
