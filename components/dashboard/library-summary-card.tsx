"use client"

import { Library } from "lucide-react"

import { LibraryGrid } from "@/components/libraries/library-grid"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { dashboardStatIconShell } from "@/lib/dashboard-card-styles"
import { Skeleton } from "@/components/ui/skeleton"
import { useLibraries } from "@/hooks/use-libraries"

export function LibrarySummaryCard() {
  const librariesQuery = useLibraries()

  return (
    <Card className="border-white/[0.1] bg-white/[0.02]">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className={dashboardStatIconShell}>
            <Library className="size-5" />
          </div>
          <div>
            <CardTitle className="text-white">Library overview</CardTitle>
            <CardDescription className="text-zinc-400">
              Default and custom libraries available on this instance.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {librariesQuery.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-40 rounded-3xl" />
            ))}
          </div>
        ) : librariesQuery.isError ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200">
            {librariesQuery.error instanceof Error
              ? librariesQuery.error.message
              : "Could not load libraries."}
          </div>
        ) : (
          <LibraryGrid libraries={librariesQuery.data ?? []} />
        )}
      </CardContent>
    </Card>
  )
}
