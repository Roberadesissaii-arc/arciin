"use client"

import Link from "next/link"
import { Files } from "lucide-react"
import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { useAssets } from "@/hooks/use-assets"
import { useLibraries } from "@/hooks/use-libraries"

export function FilesPageIntro() {
  const assetsQuery = useAssets()
  const librariesQuery = useLibraries()
  const assets = assetsQuery.data ?? []
  const libraries = librariesQuery.data ?? []
  const loading = assetsQuery.isLoading || librariesQuery.isLoading

  const videos = assets.filter((a) => a.mediaType === "VIDEO").length
  const images = assets.filter((a) => a.mediaType === "IMAGE").length

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
          label: "Total files",
          value: loading ? "…" : assets.length.toLocaleString(),
        },
        {
          label: "Libraries",
          value: loading ? "…" : libraries.length.toLocaleString(),
        },
        {
          label: "Videos",
          value: loading ? "…" : videos.toLocaleString(),
        },
        {
          label: "Images",
          value: loading ? "…" : images.toLocaleString(),
        },
      ]}
    />
  )
}
