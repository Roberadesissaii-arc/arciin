import type { ConnectorStatus } from "@/lib/api/integrations"

import { buildConnectorPathExamples } from "@/lib/integrations/connector-paths"
import { resolveJellyfinHostPaths } from "@/lib/integrations/jellyfin-install-compose"
import { resolvePlexHostPaths } from "@/lib/integrations/plex-install-compose"

export type MediaStackKind = "plex" | "jellyfin"

export type SetupShellCommands = {
  /** One-shot bash script: stack dirs + Arciin media folders on this host. */
  script: string
  /** Single mkdir line for the media server stack only. */
  stackMkdir: string
  /** mkdir lines for Arciin connector folders (may be empty until folders are enabled). */
  mediaMkdirs: string[]
  storageRoot: string | null
  librariesDir: string | null
  mediaPaths: { videos?: string; images?: string; music?: string }
}

function normalizeRoot(root: string | undefined): string | null {
  if (!root?.trim()) return null
  return root.replace(/\/$/, "")
}

function mediaPathsFromStatus(status: ConnectorStatus | undefined, kind: MediaStackKind) {
  if (!status) return {}
  return kind === "plex" ? resolvePlexHostPaths(status) : resolveJellyfinHostPaths(status)
}

/** Build copy-paste shell commands from live instance paths (never hardcode /srv/arciin). */
export function buildMediaServerSetupCommands(
  status: ConnectorStatus | undefined,
  kind: MediaStackKind,
  installDir: string,
): SetupShellCommands {
  const folderName = kind === "plex" ? "plex" : "jellyfin"
  const paths = mediaPathsFromStatus(status, kind)
  const storageRoot = normalizeRoot(status?.storageRoot)
  const librariesDir = normalizeRoot(status?.mirrorRootHint)

  const mediaPaths = {
    videos: paths.videos,
    images: paths.images,
    music: paths.music,
  }

  const stackMkdir =
    kind === "plex"
      ? `mkdir -p ${installDir}/config`
      : `mkdir -p ${installDir}/config ${installDir}/cache`

  const mediaMkdirs: string[] = []
  for (const p of [mediaPaths.videos, mediaPaths.images, mediaPaths.music]) {
    if (p) mediaMkdirs.push(`mkdir -p ${quoteShell(p)}`)
  }

  if (mediaMkdirs.length === 0 && librariesDir) {
    for (const slug of ["videos", "images", "music"] as const) {
      mediaMkdirs.push(`mkdir -p ${quoteShell(`${librariesDir}/${slug}/${folderName}`)}`)
    }
  }

  const lines: string[] = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    `# ${kind === "plex" ? "Plex" : "Jellyfin"} on the same host as Arciin`,
    `# Storage root for this instance: ${storageRoot ?? "(enable connector folders in Integrations first)"}`,
    "",
    "# 1) Media server stack directory (Plex/Jellyfin config — separate from Arciin data)",
    stackMkdir,
    "",
  ]

  if (mediaMkdirs.length > 0) {
    lines.push(
      "# 2) Arciin media folders on disk (same paths as docker-compose volume mounts)",
      "#    Arciin also creates these when you upload; this is optional prep before first upload.",
      ...mediaMkdirs,
      "",
    )
  } else {
    lines.push(
      "# 2) In Arciin → Integrations, turn on Use Plex/Jellyfin folders, then re-copy this script.",
      "",
    )
  }

  lines.push(
    `# 3) Save docker-compose.yml under ${installDir}/ and run: cd ${installDir} && docker compose up -d`,
  )

  return {
    script: lines.join("\n"),
    stackMkdir,
    mediaMkdirs,
    storageRoot,
    librariesDir,
    mediaPaths,
  }
}

export function quoteShell(path: string): string {
  if (/^[a-zA-Z0-9_./-]+$/.test(path)) return path
  return `'${path.replace(/'/g, `'\"'\"'`)}'`
}

/** Human-readable tree using this instance’s paths (not generic /srv). */
export function buildStorageLayoutTree(
  status: ConnectorStatus | undefined,
  kind: MediaStackKind,
  stackInstallDir: string,
): string {
  const folderName = kind === "plex" ? "plex" : "jellyfin"
  const storageRoot = normalizeRoot(status?.storageRoot) ?? "./data/arciin  ← your ARCIIN_DATA_DIR / Settings → Storage"
  const examples = buildConnectorPathExamples(status)
  const stackLine = `${stackInstallDir}/`
  const lines = [
    `${storageRoot}/`,
    "  libraries/",
  ]

  if (examples.length > 0) {
    for (const ex of examples) {
      const rel = ex.path.replace(`${normalizeRoot(status?.mirrorRootHint) ?? ""}/`, "")
      lines.push(`    ${rel}/   ← ${ex.libraryName} (${folderName})`)
    }
  } else {
    lines.push(`    videos/${folderName}/`)
    lines.push(`    images/${folderName}/`)
    lines.push(`    music/${folderName}/`)
  }

  lines.push(`  objects/          ← binary storage (not mounted in ${kind === "plex" ? "Plex" : "Jellyfin"})`)
  lines.push("")
  lines.push(`${stackLine}`)
  lines.push("  docker-compose.yml")
  lines.push(`  config/           ← ${kind === "plex" ? "Plex" : "Jellyfin"} database`)

  return lines.join("\n")
}

export const CONNECTOR_HOW_IT_WORKS = {
  plex: [
    "Arciin and Plex do not talk over the network. They share folders on the same machine (or any host that can read your storage root).",
    "Turn on Use Plex folders in Integrations — Arciin registers Videos/Images/Music → Plex in the database and creates those directories on disk under your configured storage root (Settings → Storage).",
    "When you upload in Arciin, files are stored under libraries/…/plex/ on disk. Plex only needs read access via Docker volume mounts pointing at those host paths.",
    "Paths in docker-compose.yml must match this instance’s storage root (e.g. dev: /home/you/arciin/data/arciin, production: /data/arciin or /srv/arciin — not a generic example path).",
  ],
  jellyfin: [
    "Arciin and Jellyfin share disk folders the same way as Plex — there is no Jellyfin API connection inside Arciin.",
    "Enable Use Jellyfin folders, upload in Arciin, then point Jellyfin libraries at the Jellyfin paths shown for this server.",
  ],
} as const
