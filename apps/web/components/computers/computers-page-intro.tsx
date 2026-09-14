"use client"

import { useQuery } from "@tanstack/react-query"
import { Monitor } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { listComputers } from "@/lib/api/computers"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"

export function ComputersPageIntro() {
  const query = useQuery({
    queryKey: queryKeys.computers,
    queryFn: ({ signal }) => listComputers(signal),
  })
  const computers = query.data ?? []
  const folders = computers.reduce((total, computer) => total + computer.roots.length, 0)
  const files = computers.reduce((total, computer) => total + computer.fileCount, 0)
  const bytes = computers.reduce((total, computer) => total + computer.byteCount, 0)
  const loading = query.isLoading

  return (
    <DashboardPageIntro
      title="My Computers"
      subtitle="One-way backup from your computers into Arciin"
      cornerDecoration={<IntroCornerIcon icon={Monitor} />}
      description="Protect Desktop, Documents, Pictures and other important folders with Arciin Desktop. Files stay on this server even if a computer is disconnected."
      stats={[
        { label: "Computers", value: loading ? "…" : computers.length.toLocaleString() },
        { label: "Protected folders", value: loading ? "…" : folders.toLocaleString() },
        { label: "Files", value: loading ? "…" : files.toLocaleString() },
        { label: "Stored", value: loading ? "…" : formatBytes(bytes) },
      ]}
    />
  )
}
