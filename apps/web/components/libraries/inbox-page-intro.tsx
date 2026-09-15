"use client"

import { Inbox } from "lucide-react"
import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { useAssets } from "@/hooks/use-assets"
import { useLibraries } from "@/hooks/use-libraries"

export function InboxPageIntro() {
  const librariesQuery = useLibraries()
  const inboxLibrary = librariesQuery.data?.find((lib) => lib.slug === "inbox")
  const assetsQuery = useAssets({ libraryId: inboxLibrary?.id })
  const loading = librariesQuery.isLoading || (Boolean(inboxLibrary?.id) && assetsQuery.isLoading)
  const assets = assetsQuery.data ?? []

  const videos = assets.filter((a) => a.mediaType === "VIDEO").length
  const images = assets.filter((a) => a.mediaType === "IMAGE").length
  const other = assets.length - videos - images

  return (
    <DashboardPageIntro
      title="Inbox"
      subtitle="Code and unclassified files land here first"
      cornerDecoration={<IntroCornerIcon icon={Inbox} />}
      description="Python, other scripts, archives, and files Arciin couldn't route land here. Documents is for PDFs and Office files — not source code. Review, move, or leave files here."
      stats={[
        { label: "Files waiting", value: loading ? "…" : assets.length.toLocaleString() },
        { label: "Videos", value: loading ? "…" : videos.toLocaleString() },
        { label: "Images", value: loading ? "…" : images.toLocaleString() },
        { label: "Other", value: loading ? "…" : other.toLocaleString() },
      ]}
    />
  )
}
