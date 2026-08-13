"use client"

import { Grid3X3, List, Search } from "lucide-react"

import {
  FilterDropdown,
  type FilterDropdownOption,
} from "@/components/ui/filter-dropdown"
import {
  KIND_CHIP_OPTIONS,
  type LibraryKindFilter,
  type LibraryViewMode,
  type SourceFilterValue,
} from "@/hooks/use-library-browser-filters"
import { cn } from "@/lib/utils"

function ViewModeButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition-colors",
        active
          ? "bg-[#FF4F12] text-white shadow-sm"
          : "text-zinc-500 hover:bg-zinc-100/80 hover:text-zinc-900",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

export function LibraryBrowserToolbar({
  search,
  onSearchChange,
  view,
  onViewChange,
  resultCount,
  showKindChips = false,
  kindFilter = "all",
  onKindFilterChange,
  sourceFilter = "all",
  onSourceFilterChange,
  sourceOptions = [],
  placeholder = "Search files and metadata",
}: {
  search: string
  onSearchChange: (value: string) => void
  view: LibraryViewMode
  onViewChange: (view: LibraryViewMode) => void
  /** Total matches for the count chip (hide when 0). */
  resultCount?: number
  /** All Files only — kind chips. */
  showKindChips?: boolean
  kindFilter?: LibraryKindFilter
  onKindFilterChange?: (value: LibraryKindFilter) => void
  sourceFilter?: SourceFilterValue
  onSourceFilterChange?: (value: SourceFilterValue) => void
  sourceOptions?: FilterDropdownOption[]
  placeholder?: string
}) {
  const sourceDropdownOptions: FilterDropdownOption[] =
    sourceOptions.length > 0
      ? sourceOptions
      : [
          { value: "all", label: "All sources" },
          { value: "This PC", label: "This PC" },
          { value: "Downloads", label: "Downloads" },
          { value: "NAS", label: "NAS" },
        ]

  return (
    <div
      className="overflow-visible rounded-2xl border border-zinc-200 bg-white shadow-sm"
      role="toolbar"
      aria-label="Search, filter, and view assets"
    >
      {/* Row A — search */}
      <div className="flex min-h-[3.25rem] items-center gap-2 rounded-t-2xl border-b border-zinc-100 bg-zinc-50/40 px-3 py-2.5 sm:px-4">
        <Search className="size-4 shrink-0 text-zinc-400" aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={placeholder}
          className={cn(
            "h-10 min-w-0 flex-1 bg-transparent px-1 text-[13px] text-zinc-900",
            "placeholder:text-zinc-400",
            "border-0 shadow-none outline-none ring-0 focus:outline-none focus:ring-0",
          )}
        />
        {typeof resultCount === "number" && resultCount > 0 ? (
          <span className="shrink-0 rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-zinc-500">
            {resultCount.toLocaleString()}
          </span>
        ) : null}
      </div>

      {/* Row B — filters + view */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:gap-3">
          {showKindChips && onKindFilterChange ? (
            <div
              className="flex flex-wrap items-center gap-1"
              role="group"
              aria-label="File kind"
            >
              {KIND_CHIP_OPTIONS.map((chip) => {
                const active = kindFilter === chip.value
                return (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => onKindFilterChange(chip.value)}
                    className={cn(
                      "h-8 rounded-lg px-2.5 text-[12px] font-semibold transition-colors",
                      active
                        ? "text-[#FF4F12]"
                        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
                    )}
                    style={
                      active
                        ? {
                            backgroundColor:
                              "color-mix(in srgb, #FF4F12 10%, transparent)",
                          }
                        : undefined
                    }
                  >
                    {chip.label}
                  </button>
                )
              })}
            </div>
          ) : null}

          {onSourceFilterChange ? (
            <FilterDropdown
              ariaLabel="Source filter"
              value={sourceFilter}
              onValueChange={(v) => onSourceFilterChange(v as SourceFilterValue)}
              options={sourceDropdownOptions}
              minWidthClass="min-w-[9.5rem]"
            />
          ) : null}
        </div>

        <div
          className="flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200/80 bg-zinc-50/60 p-1"
          role="group"
          aria-label="View mode"
        >
          <ViewModeButton
            active={view === "grid"}
            label="Grid"
            onClick={() => onViewChange("grid")}
          >
            <Grid3X3 className="size-3.5 shrink-0" />
          </ViewModeButton>
          <ViewModeButton
            active={view === "table"}
            label="List"
            onClick={() => onViewChange("table")}
          >
            <List className="size-3.5 shrink-0" />
          </ViewModeButton>
        </div>
      </div>
    </div>
  )
}
