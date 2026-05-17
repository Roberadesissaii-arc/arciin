"use client"

import { useQuery } from "@tanstack/react-query"
import { MonitorPlay } from "lucide-react"

import { MediaServerGuideCard } from "@/components/settings/media-server-guide-card"
import { PlexInstallPlaybook } from "@/components/settings/plex-install-playbook"
import { getPlexStatus } from "@/lib/api/integrations"
import { queryKeys } from "@/lib/api/query-keys"
import { buildConnectorPathExamples } from "@/lib/integrations/connector-paths"

const PLEX_DOWNLOAD_URL = "https://www.plex.tv/media-server-downloads/"

const STEPS = [
  {
    title: "Enable Plex folders in Arciin",
    body: "Turn on Use Plex folders on the Plex card so Videos, Images, and Music each get a Plex folder and uploads mirror to disk.",
  },
  {
    title: "Install Plex on your server",
    body: "Use the Docker Compose file below (/srv/plex) or install manually—Plex runs separately from Arciin but reads the same folders.",
  },
  {
    title: "Map Plex libraries",
    body: "Point Plex Movies, Photos, and Music libraries at the host paths in the install guide (matches Videos/Images/Music → Plex).",
  },
  {
    title: "Scan and watch",
    body: "Upload in Arciin, then run Scan Library in Plex if new files do not show up within a minute.",
  },
] as const

function usePlexStatusQuery() {
  return useQuery({
    queryKey: queryKeys.plexStatus,
    queryFn: ({ signal }) => getPlexStatus(signal),
  })
}

/** Left column: “Connect Plex Media Server” guide (no install playbook). */
export function PlexMediaServerGuideCard() {
  const statusQuery = usePlexStatusQuery()
  const status = statusQuery.data

  return (
    <MediaServerGuideCard
      title="Connect Plex Media Server"
      description="Stream video, photos, and music from the Plex folders Arciin keeps on disk. Install Plex on the host, then wire libraries to those paths."
      downloadLabel="Download Plex Media Server"
      downloadUrl={PLEX_DOWNLOAD_URL}
      icon={MonitorPlay}
      steps={STEPS}
      footerNote="Docker Compose, manual install, and library mapping are in the install guide below and in Docs → Plex media server."
      pathsLoading={statusQuery.isLoading}
      librariesDirectory={status?.mirrorRootHint}
      connectorPathExamples={buildConnectorPathExamples(status)}
    />
  )
}

/** Left column, row 3: “Install Plex on your server”. */
export function PlexInstallSection() {
  const statusQuery = usePlexStatusQuery()
  return (
    <div className="h-full min-h-0">
      <PlexInstallPlaybook status={statusQuery.data} pathsLoading={statusQuery.isLoading} />
    </div>
  )
}

/** Stacked layout (e.g. docs). Prefer split layout on /integrations. */
export function PlexConnectionGuideCard() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <PlexMediaServerGuideCard />
      <PlexInstallSection />
    </div>
  )
}
