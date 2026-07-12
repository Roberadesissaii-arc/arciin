"use client"

import { useQuery } from "@tanstack/react-query"
import { Film } from "lucide-react"

import { JellyfinInstallPlaybook } from "@/components/settings/jellyfin-install-playbook"
import { MediaServerGuideCard } from "@/components/settings/media-server-guide-card"
import { getJellyfinStatus } from "@/lib/api/integrations"
import { queryKeys } from "@/lib/api/query-keys"
import { buildConnectorPathExamples } from "@/lib/integrations/connector-paths"

const JELLYFIN_DOWNLOAD_URL = "https://jellyfin.org/downloads/"

const STEPS = [
  {
    title: "Enable Jellyfin folders in Arciin",
    body: "In the Jellyfin card above, turn on Use Jellyfin folders. If Plex is also on, new uploads go to Plex folders first—use only Jellyfin or move files into Jellyfin folders for Jellyfin.",
  },
  {
    title: "Install Jellyfin on your server",
    body: "Use the Docker Compose file below (/srv/jellyfin) or install manually—Jellyfin runs separately from Arciin but reads the same folders.",
  },
  {
    title: "Add Jellyfin libraries",
    body: "In Jellyfin Dashboard → Libraries, add media folders that match the Jellyfin paths in the install guide.",
  },
  {
    title: "Scan libraries",
    body: "After uploading in Arciin, refresh or scan the library in Jellyfin if items are missing.",
  },
] as const

function useJellyfinStatusQuery() {
  return useQuery({
    queryKey: queryKeys.jellyfinStatus,
    queryFn: ({ signal }) => getJellyfinStatus(signal),
  })
}

/** Right column, row 2: “Connect Jellyfin Server”. */
export function JellyfinMediaServerGuideCard() {
  const statusQuery = useJellyfinStatusQuery()
  const status = statusQuery.data

  return (
    <MediaServerGuideCard
      title="Connect Jellyfin Server"
      description="Arciin does not bundle Jellyfin. Install Jellyfin on your server, then point its libraries at the Jellyfin folders Arciin writes on disk."
      downloadLabel="Download Jellyfin"
      downloadUrl={JELLYFIN_DOWNLOAD_URL}
      icon={Film}
      steps={STEPS}
      footerNote="Docker Compose, manual install, and library mapping are in the install guide below."
      pathsLoading={statusQuery.isLoading}
      librariesDirectory={status?.mirrorRootHint}
      connectorPathExamples={buildConnectorPathExamples(status)}
    />
  )
}

/** Right column, row 3: “Install Jellyfin on your server”. */
export function JellyfinInstallSection() {
  const statusQuery = useJellyfinStatusQuery()
  return (
    <div className="h-full min-h-0">
      <JellyfinInstallPlaybook status={statusQuery.data} pathsLoading={statusQuery.isLoading} />
    </div>
  )
}

/** Stacked layout (e.g. docs). Prefer split layout on /integrations. */
export function JellyfinConnectionGuideCard() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <JellyfinMediaServerGuideCard />
      <JellyfinInstallSection />
    </div>
  )
}
