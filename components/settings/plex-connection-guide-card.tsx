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

export function PlexConnectionGuideCard() {
  const statusQuery = useQuery({
    queryKey: queryKeys.plexStatus,
    queryFn: ({ signal }) => getPlexStatus(signal),
  })

  const status = statusQuery.data

  return (
    <div className="h-full min-h-0">
    <MediaServerGuideCard
      title="Connect Plex Media Server"
      description="Arciin does not bundle Plex. Install Plex on your server, then point its libraries at the Plex folders Arciin writes on disk."
      downloadLabel="Download Plex Media Server"
      downloadUrl={PLEX_DOWNLOAD_URL}
      icon={MonitorPlay}
      steps={STEPS}
      footerNote="No Plex account is required for local streaming. Sign in only if you want remote access or Plex Pass features."
      pathsLoading={statusQuery.isLoading}
      librariesDirectory={status?.mirrorRootHint}
      connectorPathExamples={buildConnectorPathExamples(status)}
    />
    </div>
  )
}
