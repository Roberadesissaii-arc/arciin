import type { ConnectorStatus } from "@/lib/api/integrations"

export type ConnectorPathExample = {
  libraryName: string
  path: string
}

/** Full on-disk paths from API status (instance storage root), not hardcoded placeholders. */
export function buildConnectorPathExamples(
  status: ConnectorStatus | undefined,
): ConnectorPathExample[] {
  if (!status?.mirrorRootHint) return []

  const base = status.mirrorRootHint.replace(/\/$/, "")
  const order = ["videos", "images", "music"] as const
  return [...status.folders]
    .sort((a, b) => order.indexOf(a.librarySlug as (typeof order)[number]) - order.indexOf(b.librarySlug as (typeof order)[number]))
    .map((f) => ({
      libraryName: f.libraryName,
      path: `${base}/${f.folderPath}`,
    }))
}
