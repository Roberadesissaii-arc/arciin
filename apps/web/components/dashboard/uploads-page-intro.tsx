"use client"

import { Upload } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { useUploads } from "@/hooks/use-uploads"

const ACTIVE = new Set(["QUEUED", "UPLOADING", "UPLOADED", "ANALYZING", "CLASSIFIED", "PROCESSING"])

export function UploadsPageIntro() {
  const uploadsQuery = useUploads()
  const uploads = uploadsQuery.data ?? []
  const active = uploads.filter((u) => ACTIVE.has(u.status)).length
  const ready = uploads.filter((u) => u.status === "READY").length
  const failed = uploads.filter((u) => u.status === "FAILED").length

  return (
    <DashboardPageIntro
      title="Uploads"
      subtitle="Upload queue · recent sessions · classification"
      cornerDecoration={<IntroCornerIcon icon={Upload} />}
      description="Every file dropped into Arciin becomes an upload session — classification, library routing, and progress live in this log. Use All Files to browse the finished library; use this table to watch the queue and catch failures."
      stats={[
        {
          label: "Total sessions",
          value: uploadsQuery.isLoading ? "…" : uploads.length.toLocaleString(),
        },
        {
          label: "In progress",
          value: uploadsQuery.isLoading ? "…" : active.toLocaleString(),
        },
        {
          label: "Ready",
          value: uploadsQuery.isLoading ? "…" : ready.toLocaleString(),
        },
        {
          label: "Failed",
          value: uploadsQuery.isLoading ? "…" : failed.toLocaleString(),
        },
      ]}
    />
  )
}
