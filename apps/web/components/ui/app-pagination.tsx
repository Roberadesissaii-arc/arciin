"use client"

import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"

import { cn } from "@/lib/utils"

function buildPages(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "…")[] = [1]
  if (current > 3) pages.push("…")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p)
  }
  if (current < total - 2) pages.push("…")
  pages.push(total)
  return pages
}

interface AppPaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}

/**
 * Library / table pager — outlined current page (not orange fill).
 * Previous / Next stay ghost; words hide on mobile.
 */
export function AppPagination({
  page,
  totalPages,
  onPageChange,
  className,
}: AppPaginationProps) {
  if (totalPages <= 1) return null

  const pages = buildPages(page, totalPages)

  return (
    <nav
      aria-label="Pagination"
      className={cn("mx-auto flex w-full justify-center", className)}
    >
      <ul className="flex items-center gap-0.5">
        <li>
          <button
            type="button"
            aria-label="Go to previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
            className={cn(
              "inline-flex h-8 items-center gap-0.5 rounded-lg pl-1.5 pr-2 text-[12px] font-semibold text-zinc-600",
              "transition-colors hover:bg-zinc-100 hover:text-zinc-900",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <ChevronLeft className="size-4" aria-hidden />
            <span className="hidden sm:inline">Previous</span>
          </button>
        </li>

        {pages.map((p, i) =>
          p === "…" ? (
            <li key={`ell-${i}`} aria-hidden>
              <span className="flex size-8 items-center justify-center text-zinc-400">
                <MoreHorizontal className="size-4" />
              </span>
            </li>
          ) : (
            <li key={p}>
              <button
                type="button"
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
                onClick={() => onPageChange(p)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg text-[13px] font-semibold transition-colors",
                  p === page
                    ? "border border-zinc-300 bg-white text-zinc-700"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                )}
              >
                {p}
              </button>
            </li>
          ),
        )}

        <li>
          <button
            type="button"
            aria-label="Go to next page"
            disabled={page >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            className={cn(
              "inline-flex h-8 items-center gap-0.5 rounded-lg pl-2 pr-1.5 text-[12px] font-semibold text-zinc-600",
              "transition-colors hover:bg-zinc-100 hover:text-zinc-900",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </li>
      </ul>
    </nav>
  )
}

/** White rounded bar under a card grid. */
export function GridPaginationBar({
  page,
  totalPages,
  onPageChange,
}: AppPaginationProps) {
  if (totalPages <= 1) return null
  return (
    <div className="flex w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 shadow-sm">
      <AppPagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
    </div>
  )
}
