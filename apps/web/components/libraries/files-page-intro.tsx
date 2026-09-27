"use client"

import Link from "next/link"
import { Files } from "lucide-react"
import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { useQuery } from "@tanstack/react-query"
import { getAssetStats } from "@/lib/api/assets"
import { queryKeys } from "@/lib/api/query-keys"
import { useLibraries } from "@/hooks/use-libraries"

export function FilesPageIntro() {
  /**
   * Counts come from the database, not from the array this page happens to
   * hold.
   *
   * These used to be assets.length and assets.filter(...) over whatever the
   * browser had fetched — one page of results — so the header disagreed with
   * the sidebar in both directions depending on what that page contained. The
   * sidebar was right; the header was counting a sample.
   */
  const statsQuery = useQuery({
    queryKey: queryKeys.assetStats,
    queryFn: ({ signal }) => getAssetStats(signal),
  })
  const librariesQuery = useLibraries()
  const libraries = librariesQuery.data ?? []
  const stats = statsQuery.data
  const loading = statsQuery.isLoading || librariesQuery.isLoading

  return (
    <DashboardPageIntro
      title="All Files"
      subtitle="Instance-wide browser · every library in one place"
      cornerDecoration={<IntroCornerIcon icon={Files} />}
      description={
        <>
          Search and manage assets across every library on this instance. Switch between grid and list
          view, select multiple files for bulk actions, or open a library from the sidebar for
          folder-level organization. Activity from uploads and moves appears on{" "}
          <Link href="/activity" className="font-medium text-foreground underline-offset-2 hover:underline">
            Activity
          </Link>
          .
        </>
      }
      stats={[
        {
          // "Active" rather than bare "files": archived items still exist, and
          // a number that quietly leaves them out should say so.
          label: "Active files",
          value: loading ? "…" : (stats?.active ?? 0).toLocaleString(),
        },
        {
          label: "Libraries",
          value: loading ? "…" : libraries.length.toLocaleString(),
        },
        {
          label: "Videos",
          value: loading ? "…" : (stats?.videos ?? 0).toLocaleString(),
        },
        {
          label: "Images",
          value: loading ? "…" : (stats?.images ?? 0).toLocaleString(),
        },
        ...(stats?.archived
          ? [{ label: "Archived", value: stats.archived.toLocaleString() }]
          : []),
      ]}
    />
  )
}
