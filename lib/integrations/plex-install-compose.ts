import type { ConnectorStatus } from "@/lib/api/integrations"

import { buildConnectorPathExamples } from "@/lib/integrations/connector-paths"

export const DEFAULT_PLEX_INSTALL_DIR = "/srv/plex"

export type PlexHostPaths = {
  videos?: string
  images?: string
  music?: string
  librariesDir?: string
  storageRoot?: string
}

export type PlexDockerComposeOptions = {
  installDir?: string
  paths: PlexHostPaths
  puid?: string
  pgid?: string
  tz?: string
  claimToken?: string
}

/** Map connector status to on-disk Plex folder paths for this instance. */
export function resolvePlexHostPaths(status: ConnectorStatus | undefined): PlexHostPaths {
  if (!status) return {}

  const examples = buildConnectorPathExamples(status)
  const bySlug = Object.fromEntries(
    examples.map((ex) => {
      const folder = status.folders.find((f) => f.libraryName === ex.libraryName)
      return [folder?.librarySlug ?? ex.libraryName, ex.path] as const
    }),
  )

  return {
    storageRoot: status.storageRoot,
    librariesDir: status.mirrorRootHint,
    videos: bySlug.videos,
    images: bySlug.images,
    music: bySlug.music,
  }
}

function placeholderPath(
  kind: "videos" | "images" | "music",
  paths: PlexHostPaths,
) {
  const resolved = paths[kind]
  if (resolved) return resolved
  const base =
    paths.librariesDir?.replace(/\/$/, "") ??
    (paths.storageRoot
      ? `${paths.storageRoot.replace(/\/$/, "")}/libraries`
      : "./data/arciin/libraries")
  return `${base}/${kind}/plex`
}

export function buildPlexDockerCompose(options: PlexDockerComposeOptions): string {
  const installDir = options.installDir ?? DEFAULT_PLEX_INSTALL_DIR
  const configDir = `${installDir}/config`
  const videos = options.paths.videos ?? placeholderPath("videos", options.paths)
  const images = options.paths.images ?? placeholderPath("images", options.paths)
  const music = options.paths.music ?? placeholderPath("music", options.paths)
  const puid = options.puid ?? "1000"
  const pgid = options.pgid ?? "1000"
  const tz = options.tz ?? "America/New_York"
  const claim = options.claimToken ?? "claim-YOUR_TOKEN_FROM_https://plex.tv/claim"

  return `version: "3.8"

services:
  plex:
    image: lscr.io/linuxserver/plex:latest
    container_name: plex_server
    network_mode: host
    environment:
      - PUID=${puid}
      - PGID=${pgid}
      - TZ=${tz}
      - VERSION=docker
      - PLEX_CLAIM=${claim}
    volumes:
      - ${configDir}:/config
      - ${videos}:/movies:ro
      - ${images}:/photos:ro
      - ${music}:/music:ro
    restart: unless-stopped
`
}

export const PLEX_LIBRARY_MAPPING = [
  {
    plexType: "Movies",
    containerPath: "/movies",
    arciinLibrary: "Videos",
    arciinFolder: "Plex",
    slug: "videos" as const,
  },
  {
    plexType: "Photos",
    containerPath: "/photos",
    arciinLibrary: "Images",
    arciinFolder: "Plex",
    slug: "images" as const,
  },
  {
    plexType: "Music",
    containerPath: "/music",
    arciinLibrary: "Music",
    arciinFolder: "Plex",
    slug: "music" as const,
  },
] as const
