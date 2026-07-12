"use client"

import { Grid3X3, List, Search, Tag } from "lucide-react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { BadgeFilterOption, BadgeFilterValue } from "@/lib/utils/asset-badge-filter"
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
        "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

const selectTriggerClass =
  "h-9 min-w-[9.5rem] border-border bg-muted/30 text-sm text-foreground hover:bg-muted/50 focus-visible:ring-primary/20"

export function LibraryBrowserToolbar({
  search,
  onSearchChange,
  view,
  onViewChange,
  badgeFilter = "all",
  onBadgeFilterChange,
  badgeOptions = [],
  placeholder = "Search files and metadata",
}: {
  search: string
  onSearchChange: (value: string) => void
  view: "grid" | "table"
  onViewChange: (view: "grid" | "table") => void
  badgeFilter?: BadgeFilterValue
  onBadgeFilterChange?: (value: BadgeFilterValue) => void
  badgeOptions?: BadgeFilterOption[]
  placeholder?: string
}) {
  const showBadgeFilter = Boolean(onBadgeFilterChange)

  return (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
      role="toolbar"
      aria-label="Search, filter, and view assets"
    >
      <div className="flex min-h-[3.25rem] items-center gap-2 border-b border-border/80 bg-muted/15 px-3 py-2.5 sm:px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={placeholder}
          className="h-10 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm leading-normal shadow-none placeholder:text-muted-foreground focus-visible:ring-0"
        />
      </div>

      <div className="flex min-h-[3.25rem] flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          {showBadgeFilter ? (
            <div className="flex items-center gap-2">
              <Label
                htmlFor="library-badge-filter"
                className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                <Tag className="size-3.5" aria-hidden />
                Badge
              </Label>
              <Select
                value={badgeFilter}
                onValueChange={(value) => onBadgeFilterChange?.(value as BadgeFilterValue)}
              >
                <SelectTrigger id="library-badge-filter" size="default" className={selectTriggerClass}>
                  <SelectValue placeholder="All badges" />
                </SelectTrigger>
                <SelectContent position="popper" side="bottom" align="start" sideOffset={6}>
                  <SelectItem value="all">All badges</SelectItem>
                  <SelectItem value="none">No badge</SelectItem>
                  {badgeOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      <span className="flex items-center gap-2">
                        {option.color ? (
                          <span
                            className="size-2.5 shrink-0 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: option.color }}
                            aria-hidden
                          />
                        ) : null}
                        {option.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <div
          className="flex shrink-0 items-center gap-1 rounded-lg border border-border/80 bg-muted/20 p-1"
          role="group"
          aria-label="View mode"
        >
          <ViewModeButton active={view === "grid"} label="Grid" onClick={() => onViewChange("grid")}>
            <Grid3X3 className="size-3.5 shrink-0" />
          </ViewModeButton>
          <ViewModeButton active={view === "table"} label="List" onClick={() => onViewChange("table")}>
            <List className="size-3.5 shrink-0" />
          </ViewModeButton>
        </div>
      </div>
    </div>
  )
}
