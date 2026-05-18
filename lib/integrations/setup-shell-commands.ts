import type { ConnectorStatus } from "@/lib/api/integrations"

import { buildConnectorPathExamples } from "@/lib/integrations/connector-paths"
import {
  buildJellyfinDockerCompose,
  resolveJellyfinHostPaths,
} from "@/lib/integrations/jellyfin-install-compose"
import {
  buildPlexDockerCompose,
  resolvePlexHostPaths,
} from "@/lib/integrations/plex-install-compose"

export type MediaStackKind = "plex" | "jellyfin"

export type SetupShellCommands = {
  /** Paste-safe bash: creates stack dirs and writes docker-compose.yml on the host. */
  script: string
  stackMkdir: string
  /** @deprecated Arciin creates connector folders via Integrations — kept for compatibility. */
  mediaMkdirs: string[]
  storageRoot: string | null
  librariesDir: string | null
  mediaPaths: { videos?: string; images?: string; music?: string }
  composePath: string
}

function normalizeRoot(root: string | undefined): string | null {
  if (!root?.trim()) return null
  return root.replace(/\/$/, "")
}

function mediaPathsFromStatus(status: ConnectorStatus | undefined, kind: MediaStackKind) {
  if (!status) return {}
  return kind === "plex" ? resolvePlexHostPaths(status) : resolveJellyfinHostPaths(status)
}

function needsSudoForPath(path: string) {
  return /^\/(srv|opt|usr|var|etc|mnt)\//.test(path)
}

export function quoteShell(path: string): string {
  if (/^[a-zA-Z0-9_./-]+$/.test(path)) return path
  return `'${path.replace(/'/g, `'\"'\"'`)}'`
}

const COMPOSE_HEREDOC_END = "ARCIIN_COMPOSE_YML_END"

function buildPasteableInstallScript(
  installDir: string,
  kind: MediaStackKind,
  compose: string,
  storageRoot: string | null,
): string {
  const sudo = needsSudoForPath(installDir) ? "sudo " : ""
  const stackLabel = kind === "plex" ? "Plex" : "Jellyfin"
  const connectorFolder = kind === "plex" ? "plex" : "jellyfin"

  const lines: string[] = [
    "# Paste into your SSH session on the host that runs Arciin (runs line by line; safe to paste).",
    `# ${stackLabel} stack — separate from Arciin data under your storage root.`,
    `#`,
    `#   ${installDir}/docker-compose.yml   ← compose file (edit claim token / PUID / PGID here)`,
    `#   ${installDir}/config/            ← ${stackLabel} app database (created empty)`,
    ...(kind === "jellyfin" ? [`#   ${installDir}/cache/             ← Jellyfin transcode cache`] : []),
    "#",
    `# Arciin media paths: enable "Use ${stackLabel} folders" in Integrations — Arciin creates`,
    `# libraries/videos|images|music/${connectorFolder}/ for you. Do not mkdir those here.`,
    "",
    `INSTALL_DIR=${quoteShell(installDir)}`,
    `${sudo}mkdir -p "$INSTALL_DIR/config"`,
  ]

  if (kind === "jellyfin") {
    lines.push(`${sudo}mkdir -p "$INSTALL_DIR/cache"`)
  }

  lines.push(
    "",
    `# Write docker-compose.yml next to config/ (not inside config/)`,
    `cat <<'${COMPOSE_HEREDOC_END}' | ${sudo}tee "$INSTALL_DIR/docker-compose.yml" > /dev/null`,
    compose.trimEnd(),
    COMPOSE_HEREDOC_END,
    "",
    'echo ""',
    `echo "Created $INSTALL_DIR/docker-compose.yml"`,
    `echo "         $INSTALL_DIR/config/"`,
  )

  if (storageRoot) {
    lines.push(`echo "Arciin media folders: ${storageRoot}/libraries/…/${connectorFolder}/"`)
  } else {
    lines.push(
      `echo "Tip: turn on Use ${stackLabel} folders in Arciin → Integrations, then re-copy the compose block for real volume paths."`,
    )
  }

  lines.push(
    `echo 'Next: ${sudo}nano "$INSTALL_DIR/docker-compose.yml"'`,
    `echo 'Then: cd "$INSTALL_DIR" && docker compose up -d'`,
  )

  return lines.join("\n")
}

/** Build copy-paste shell commands from live instance paths (never hardcode /srv/arciin). */
export function buildMediaServerSetupCommands(
  status: ConnectorStatus | undefined,
  kind: MediaStackKind,
  installDir: string,
): SetupShellCommands {
  const paths = mediaPathsFromStatus(status, kind)
  const storageRoot = normalizeRoot(status?.storageRoot)
  const librariesDir = normalizeRoot(status?.mirrorRootHint)

  const mediaPaths = {
    videos: paths.videos,
    images: paths.images,
    music: paths.music,
  }

  const sudo = needsSudoForPath(installDir) ? "sudo " : ""
  const stackMkdir =
    kind === "plex"
      ? `${sudo}mkdir -p ${quoteShell(`${installDir}/config`)}`
      : `${sudo}mkdir -p ${quoteShell(`${installDir}/config`)} ${quoteShell(`${installDir}/cache`)}`

  const compose =
    kind === "plex"
      ? buildPlexDockerCompose({ installDir, paths })
      : buildJellyfinDockerCompose({ installDir, paths })

  const composePath = `${installDir}/docker-compose.yml`
  const script = buildPasteableInstallScript(installDir, kind, compose, storageRoot)

  return {
    script,
    stackMkdir,
    mediaMkdirs: [],
    storageRoot,
    librariesDir,
    mediaPaths,
    composePath,
  }
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
    "  libraries/   ← Arciin creates …/plex (or jellyfin) when Integrations is enabled",
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
  lines.push(`${stackLine}   ← ${kind === "plex" ? "Plex" : "Jellyfin"} Docker stack (not inside Arciin data)`)
  lines.push("  docker-compose.yml")
  lines.push(`  config/           ← ${kind === "plex" ? "Plex" : "Jellyfin"} database`)

  return lines.join("\n")
}

export const CONNECTOR_HOW_IT_WORKS = {
  plex: [
    "Arciin and Plex do not talk over the network. They share folders on the same machine (or any host that can read your storage root).",
    "In Integrations, turn on Use Plex folders — Arciin registers Videos/Images/Music → Plex and creates those directories under your storage root (Settings → Storage). You do not need to create library folders manually on disk.",
    "The setup script below only prepares /srv/plex (or your install dir): config/ plus docker-compose.yml beside it. Volume lines point at Arciin’s libraries/…/plex paths when folders are enabled.",
    "When you upload in Arciin, files land under libraries/…/plex/. Plex reads them via Docker volume mounts in docker-compose.yml.",
  ],
  jellyfin: [
    "Arciin and Jellyfin share disk folders the same way as Plex — there is no network API connection between them.",
    "In Integrations, turn on Use Jellyfin folders — Arciin creates Videos/Images/Music → Jellyfin on disk. Do not mkdir those paths manually.",
    "The setup script prepares your Jellyfin install dir (config/, cache/, docker-compose.yml). Use the paths shown for this instance in the compose file.",
    "When you upload in Arciin, files land under libraries/…/jellyfin/. Jellyfin reads them via Docker volume mounts.",
  ],
} as const
