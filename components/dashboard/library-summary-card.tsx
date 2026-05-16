"use client"

import { DatabaseHubCard } from "@/components/dashboard/database-hub-card"
import { LibraryCard } from "@/components/libraries/library-card"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useLibraries } from "@/hooks/use-libraries"
import { cn } from "@/lib/utils"
import type { LibrarySummary } from "@/lib/types/models"

const LIBRARY_ORDER = ["videos", "images", "music", "documents", "inbox"]

function sortLibraries(libraries: LibrarySummary[]) {
  return [...libraries].sort(
    (a, b) => LIBRARY_ORDER.indexOf(a.slug) - LIBRARY_ORDER.indexOf(b.slug),
  )
}

export function LibrarySummaryCard({
  embedded = false,
  className,
}: {
  embedded?: boolean
  className?: string
}) {
  const librariesQuery = useLibraries()
  const libraries = sortLibraries(librariesQuery.data ?? [])

  const body = librariesQuery.isLoading ? (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-36 rounded-2xl" />
      ))}
    </div>
  ) : librariesQuery.isError ? (
    <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-800">
      {librariesQuery.error instanceof Error
        ? librariesQuery.error.message
        : "Could not load libraries."}
    </div>
  ) : (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {libraries.map((library) => (
        <LibraryCard key={library.id} library={library} />
      ))}
      <DatabaseHubCard />
    </div>
  )

  if (embedded) {
    return <div className={className}>{body}</div>
  }

  return (
    <Card className={cn("border-border bg-card shadow-sm", className)}>
      <CardContent className="pt-6">{body}</CardContent>
    </Card>
  )
}
