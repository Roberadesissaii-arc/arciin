"use client"

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"

function buildPages(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pages: (number | "…")[] = [1]
  if (current > 3) pages.push("…")
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p)
  if (current < total - 2) pages.push("…")
  pages.push(total)
  return pages
}

interface AppPaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function AppPagination({ page, totalPages, onPageChange }: AppPaginationProps) {
  if (totalPages <= 1) return null

  return (
    <Pagination>
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            onClick={(e) => { e.preventDefault(); onPageChange(Math.max(1, page - 1)) }}
            className={page === 1 ? "pointer-events-none opacity-40" : "cursor-pointer"}
          />
        </PaginationItem>

        {buildPages(page, totalPages).map((p, i) =>
          p === "…" ? (
            <PaginationItem key={`ell-${i}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : (
            <PaginationItem key={p}>
              <PaginationLink
                href="#"
                isActive={p === page}
                onClick={(e) => { e.preventDefault(); onPageChange(p) }}
                className="cursor-pointer"
              >
                {p}
              </PaginationLink>
            </PaginationItem>
          ),
        )}

        <PaginationItem>
          <PaginationNext
            href="#"
            onClick={(e) => { e.preventDefault(); onPageChange(Math.min(totalPages, page + 1)) }}
            className={page === totalPages ? "pointer-events-none opacity-40" : "cursor-pointer"}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
