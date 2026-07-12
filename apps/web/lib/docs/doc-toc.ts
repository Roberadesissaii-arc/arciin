export type DocTocItem = { id: string; label: string }

export type DocTocGroup = {
  label: string
  items: DocTocItem[]
}

export const DOC_TOC_GROUPS: DocTocGroup[] = [
  {
    label: "Getting started",
    items: [
      { id: "overview", label: "Overview" },
      { id: "upgrading", label: "Install & upgrade" },
      { id: "urls", label: "URLs & environment" },
    ],
  },
  {
    label: "API & auth",
    items: [
      { id: "external-apps", label: "External apps & keys" },
      { id: "playground", label: "API explorer" },
      { id: "rest", label: "Authentication" },
      { id: "api-keys", label: "API keys" },
    ],
  },
  {
    label: "Libraries & files",
    items: [
      { id: "libraries", label: "Libraries & folders" },
      { id: "assets", label: "Assets" },
      { id: "uploads", label: "File uploads" },
      { id: "example-scripts", label: "Example scripts" },
    ],
  },
  {
    label: "Integrations",
    items: [
      { id: "integrations-overview", label: "How connectors work" },
      { id: "plex-same-server", label: "Plex · same server" },
      { id: "plex-remote-server", label: "Plex · remote server" },
      { id: "plex-library-scan", label: "Refresh Plex libraries" },
      { id: "jellyfin-connector", label: "Jellyfin" },
      { id: "connector-automation", label: "Webhooks & realtime" },
    ],
  },
  {
    label: "App data",
    items: [{ id: "databases", label: "App databases" }],
  },
  {
    label: "Realtime & access",
    items: [
      { id: "responses", label: "JSON responses" },
      { id: "realtime", label: "Socket.IO" },
      { id: "webhooks", label: "Webhooks" },
      { id: "remote", label: "Remote access" },
    ],
  },
  {
    label: "Reference",
    items: [{ id: "events", label: "Event catalogue" }],
  },
]

export function flattenDocToc(): DocTocItem[] {
  return DOC_TOC_GROUPS.flatMap((group) => group.items)
}
