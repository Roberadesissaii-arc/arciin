import { cn } from "@/lib/utils"

import { accentIconShellMd } from "@/lib/accent-styles"

export const dashboardStatIconShell = accentIconShellMd

/** Shared feed list styling for dashboard overview panels (uploads + activity). */
export const dashboardFeedList =
  "flex min-h-0 flex-1 flex-col divide-y divide-zinc-200/80"

/** Panel body fills the card so uploads and activity share the same height. */
export const dashboardPanelBody =
  "flex min-h-[26rem] flex-1 flex-col overflow-hidden"

export const dashboardPanelCard = "flex h-full min-h-[28rem] flex-col md:min-h-[30rem] lg:min-h-[32rem]"

/** Dashboard overview row — natural height (do not stretch with h-full). */
export const dashboardOverviewPanelCard = "flex shrink-0 flex-col"

/**
 * Fixed body height for the 7×2 overview uploads grid
 * (2 tile rows + gap). Keeps the section stable when loading/empty.
 */
export const dashboardOverviewUploadsBody =
  "flex h-[17.75rem] shrink-0 flex-col sm:h-[18.75rem] lg:h-[20rem]"

export const dashboardOverviewActivityBody =
  "flex min-h-0 flex-1 flex-col overflow-hidden"

/** Dashboard uploads grid: 7 columns × 2 rows on wide screens. */
export const DASHBOARD_UPLOADS_GRID_COLS = 7
export const DASHBOARD_UPLOADS_GRID_ROWS = 2
export const DASHBOARD_UPLOADS_LIMIT =
  DASHBOARD_UPLOADS_GRID_COLS * DASHBOARD_UPLOADS_GRID_ROWS

/** How many activity rows the dashboard widget shows (desktop). */
export const DASHBOARD_ACTIVITY_LIMIT = 6

/** Tablet overview — fewer rows so the feed never stretches past uploads. */
export const DASHBOARD_ACTIVITY_LIMIT_TABLET = 5

/**
 * Full-width 7×2 grid. Tile rows are a touch taller than before so
 * previews read more clearly inside the fixed body height.
 */
export const dashboardUploadsGrid =
  "grid h-full grid-cols-3 gap-2 content-start [grid-auto-rows:8.5rem] sm:grid-cols-4 sm:gap-2.5 sm:[grid-auto-rows:9rem] md:grid-cols-5 lg:grid-cols-7 lg:grid-rows-2 lg:[grid-auto-rows:9.625rem]"

/** Activity list on the dashboard — rows grow to fill height on large screens only. */
export const dashboardActivityList =
  "flex min-h-0 flex-1 flex-col divide-y divide-zinc-200/80 overflow-hidden max-lg:justify-start"

export const dashboardFeedRow = cn(
  "group flex items-start gap-2.5 rounded-xl px-2.5 py-2 transition-colors",
  "hover:bg-zinc-50/90",
)

export const dashboardFeedEmpty = cn(
  "flex flex-1 flex-col items-center justify-center rounded-xl",
  "border border-dashed border-zinc-200/90 bg-gradient-to-b from-zinc-50/90 to-transparent",
  "px-6 py-10 text-center",
)

export const dashboardFeedMeta = "flex shrink-0 flex-col items-end gap-1 text-right"
