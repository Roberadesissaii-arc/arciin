"use client"

import { useQuery } from "@tanstack/react-query"
import { Film } from "lucide-react"

import { MediaServerGuideCard } from "@/components/settings/media-server-guide-card"
import { getJellyfinStatus } from "@/lib/api/integrations"
import { queryKeys } from "@/lib/api/query-keys"
import { buildConnectorPathExamples } from "@/lib/integrations/connector-paths"

const JELLYFIN_DOWNLOAD_URL = "https://jellyfin.org/downloads/"

const STEPS = [
  {
    title: "Install Jellyfin Server",
    body: "Download Jellyfin for your OS (Linux, Windows, macOS, or Docker). Install it on the same host as Arciin or on a machine that can read your storage folder.",
  },
  {
    title: "Enable Jellyfin folders in Arciin",
    body: "In the Jellyfin card above, turn on Use Jellyfin folders. If Plex is also on, new uploads go to Plex folders first—use only Jellyfin or move files into Jellyfin folders for Jellyfin.",
  },
  {
    title: "Add Jellyfin libraries",
    body: "In Jellyfin Dashboard → Libraries, add media folders that match the Jellyfin paths listed below for this server.",
  },
  {
    title: "Scan libraries",
    body: "After uploading in Arciin, refresh or scan the library in Jellyfin if items are missing.",
  },
] as const

export function JellyfinConnectionGuideCard() {
  const statusQuery = useQuery({
    queryKey: queryKeys.jellyfinStatus,
    queryFn: ({ signal }) => getJellyfinStatus(signal),
  })

  const status = statusQuery.data

  return (
    <div className="h-full min-h-0">
    <MediaServerGuideCard
      title="Connect Jellyfin Server"
      description="Arciin does not bundle Jellyfin. Install Jellyfin on your server, then point its libraries at the Jellyfin folders Arciin writes on disk."
      downloadLabel="Download Jellyfin"
      downloadUrl={JELLYFIN_DOWNLOAD_URL}
      icon={Film}
      steps={STEPS}
      footerNote="Jellyfin is free and open source. No Jellyfin account is required on your own server."
      pathsLoading={statusQuery.isLoading}
      librariesDirectory={status?.mirrorRootHint}
      connectorPathExamples={buildConnectorPathExamples(status)}
    />
    </div>
  )
}
