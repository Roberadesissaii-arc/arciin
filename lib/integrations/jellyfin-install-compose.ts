import type { ConnectorStatus } from "@/lib/api/integrations"

import { buildConnectorPathExamples } from "@/lib/integrations/connector-paths"

export const DEFAULT_JELLYFIN_INSTALL_DIR = "/srv/jellyfin"

export type JellyfinHostPaths = {
  videos?: string
  images?: string
  music?: string
  librariesDir?: string
  storageRoot?: string
}

export type JellyfinDockerComposeOptions = {
  installDir?: string
  paths: JellyfinHostPaths
  puid?: string
  pgid?: string
  tz?: string
}

export function resolveJellyfinHostPaths(status: ConnectorStatus | undefined): JellyfinHostPaths {
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
  paths: JellyfinHostPaths,
) {
  const resolved = paths[kind]
  if (resolved) return resolved
  const base =
    paths.librariesDir?.replace(/\/$/, "") ??
    (paths.storageRoot
      ? `${paths.storageRoot.replace(/\/$/, "")}/libraries`
      : "./data/arciin/libraries")
  return `${base}/${kind}/jellyfin`
}

export function buildJellyfinDockerCompose(options: JellyfinDockerComposeOptions): string {
  const installDir = options.installDir ?? DEFAULT_JELLYFIN_INSTALL_DIR
  const configDir = `${installDir}/config`
  const cacheDir = `${installDir}/cache`
  const videos = options.paths.videos ?? placeholderPath("videos", options.paths)
  const images = options.paths.images ?? placeholderPath("images", options.paths)
  const music = options.paths.music ?? placeholderPath("music", options.paths)
  const puid = options.puid ?? "1000"
  const pgid = options.pgid ?? "1000"
  const tz = options.tz ?? "America/New_York"

  return `version: "3.8"

services:
  jellyfin:
    image: jellyfin/jellyfin:latest
    container_name: jellyfin_server
    environment:
      - PUID=${puid}
      - PGID=${pgid}
      - TZ=${tz}
    volumes:
      - ${configDir}:/config
      - ${cacheDir}:/cache
      - ${videos}:/media/movies:ro
      - ${images}:/media/photos:ro
      - ${music}:/media/music:ro
    ports:
      - "8096:8096"
    restart: unless-stopped
`
}

export const JELLYFIN_LIBRARY_MAPPING = [
  {
    jellyfinType: "Movies",
    containerPath: "/media/movies",
    arciinLibrary: "Videos",
    arciinFolder: "Jellyfin",
    slug: "videos" as const,
  },
  {
    jellyfinType: "Photos",
    containerPath: "/media/photos",
    arciinLibrary: "Images",
    arciinFolder: "Jellyfin",
    slug: "images" as const,
  },
  {
    jellyfinType: "Music",
    containerPath: "/media/music",
    arciinLibrary: "Music",
    arciinFolder: "Jellyfin",
    slug: "music" as const,
  },
] as const
