import fs from "node:fs"
import { access, mkdir, readFile, statfs } from "node:fs/promises"
import path from "node:path"

import { ARCIIN_DEFAULT_STORAGE_ROOT } from "@arciin/shared"

import { apiConfig } from "@/config"
import { assertStorageWritable, ensureStorageDirectories, probeStorageRoot } from "@/services/storage/local-storage"

export type StorageVolumeOption = {
  id: string
  label: string
  arciinPath: string
  mountPoint: string | null
  kind: "recommended" | "mount" | "runtime" | "os-root" | "custom"
  filesystem: string | null
  device: string | null
  totalBytes: number | null
  availableBytes: number | null
  writable: boolean
  recommended: boolean
  /** Larger than OS root and good candidate for media */
  largeExternal: boolean
}

export type StorageDiscovery = {
  runtimeDataDir: string
  hostDataDir: string | null
  isDockerRuntime: boolean
  recommendedArciinPath: string
  osRoot: {
    mountPoint: string
    totalBytes: number | null
    availableBytes: number | null
  }
  volumes: StorageVolumeOption[]
  installNotes: string[]
}

const ARCIIN_SUBDIR = "arciin"
const SKIP_FS = new Set([
  "tmpfs",
  "devtmpfs",
  "proc",
  "sysfs",
  "devpts",
  "cgroup",
  "cgroup2",
  "pstore",
  "bpf",
  "tracefs",
  "debugfs",
  "securityfs",
  "mqueue",
  "hugetlbfs",
  "configfs",
  "fusectl",
  "binfmt_misc",
  "autofs",
  "overlay",
  "squashfs",
  "efivarfs",
])

function isDockerRuntime(): boolean {
  return path.resolve(apiConfig.dataDir) === "/data/arciin"
}

function hostDataDir(): string | null {
  const raw = process.env.ARCIIN_HOST_DATA_DIR?.trim()
  if (!raw) return null
  return path.resolve(raw)
}

function arciinPathForMount(mountPoint: string): string {
  const base = mountPoint === "/" ? "/srv/arciin-storage" : mountPoint.replace(/\/$/, "")
  if (base.endsWith("/arciin") || base.endsWith("/arciin-data")) {
    return base.endsWith("/arciin") ? base : path.join(base, ARCIIN_SUBDIR)
  }
  if (base === "/srv/arciin-storage") {
    return ARCIIN_DEFAULT_STORAGE_ROOT
  }
  return path.join(base, ARCIIN_SUBDIR)
}

async function probeMount(mountPoint: string): Promise<{
  totalBytes: number | null
  availableBytes: number | null
  writable: boolean
}> {
  try {
    await access(mountPoint, fs.constants.R_OK)
    const writable = await assertStorageWritable(mountPoint)
    const stats = await statfs(mountPoint)
    return {
      writable,
      totalBytes: Number(stats.bsize * stats.blocks),
      availableBytes: Number(stats.bsize * stats.bavail),
    }
  } catch {
    return { writable: false, totalBytes: null, availableBytes: null }
  }
}

type ParsedMount = {
  device: string
  mountPoint: string
  filesystem: string
}

async function parseLinuxMounts(): Promise<ParsedMount[]> {
  try {
    const raw = await readFile("/proc/mounts", "utf8")
    const mounts: ParsedMount[] = []
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue
      const parts = line.split(" ")
      if (parts.length < 3) continue
      const device = parts[0]!
      const mountPoint = parts[1]!
      const filesystem = parts[2]!
      if (SKIP_FS.has(filesystem)) continue
      if (mountPoint.startsWith("/proc") || mountPoint.startsWith("/sys")) continue
      mounts.push({ device, mountPoint, filesystem })
    }
    return mounts
  } catch {
    return []
  }
}

function volumeLabel(kind: StorageVolumeOption["kind"], mountPoint: string, filesystem: string | null): string {
  if (kind === "recommended") return "Recommended — outside the app folder"
  if (kind === "runtime") return "Current API data directory"
  if (mountPoint === "/") return "OS root filesystem"
  if (mountPoint.startsWith("/media/") || mountPoint.startsWith("/mnt/")) {
    return `Mounted drive — ${mountPoint}`
  }
  if (mountPoint.startsWith("/srv/")) return `Server volume — ${mountPoint}`
  return `${mountPoint}${filesystem ? ` (${filesystem})` : ""}`
}

export type StorageVolumeContext = {
  effectiveRoot: string
  displayRoot: string
  discovery: StorageDiscovery
}

/** True when this volume option is already the active Arciin storage location. */
export function isVolumeCurrentStorage(
  volume: Pick<StorageVolumeOption, "arciinPath">,
  ctx: StorageVolumeContext,
): boolean {
  const resolved = path.resolve(volume.arciinPath)
  const effective = path.resolve(ctx.effectiveRoot)
  const display = path.resolve(ctx.displayRoot)

  if (resolved === effective || resolved === display) return true

  const host = ctx.discovery.hostDataDir ? path.resolve(ctx.discovery.hostDataDir) : null
  if (host && resolved === host) return true

  const recommended = path.resolve(ctx.discovery.recommendedArciinPath)
  if (resolved === recommended && host && effective === path.resolve(ctx.discovery.runtimeDataDir)) {
    return true
  }

  if (ctx.discovery.isDockerRuntime) {
    const runtime = path.resolve(ctx.discovery.runtimeDataDir)
    if (effective === runtime && host && resolved === host) return true
    if (effective === runtime && resolved === runtime) return true
  }

  return false
}

export function annotateStorageVolumes(
  discovery: StorageDiscovery,
  ctx: Omit<StorageVolumeContext, "discovery">,
): Array<StorageVolumeOption & { isCurrent: boolean }> {
  const fullCtx: StorageVolumeContext = { ...ctx, discovery }
  return discovery.volumes.map((v) => ({
    ...v,
    isCurrent: isVolumeCurrentStorage(v, fullCtx),
  }))
}

export function filterMigrationTargets(
  discovery: StorageDiscovery,
  ctx: StorageVolumeContext,
): StorageVolumeOption[] {
  return discovery.volumes.filter((v) => {
    if (isVolumeCurrentStorage(v, ctx)) return false
    return v.writable || v.availableBytes != null
  })
}

export async function discoverStorageVolumes(): Promise<StorageDiscovery> {
  const runtimeDataDir = path.resolve(apiConfig.dataDir)
  const host = hostDataDir()
  const docker = isDockerRuntime()
  const recommended = host ?? ARCIIN_DEFAULT_STORAGE_ROOT

  const osProbe = await probeMount("/")
  const osAvailable = osProbe.availableBytes ?? 0

  const seenPaths = new Set<string>()
  const volumes: StorageVolumeOption[] = []

  async function addOption(input: {
    id: string
    arciinPath: string
    mountPoint: string | null
    kind: StorageVolumeOption["kind"]
    filesystem?: string | null
    device?: string | null
    recommended?: boolean
    largeExternal?: boolean
  }) {
    const resolved = path.resolve(input.arciinPath)
    if (seenPaths.has(resolved)) return
    seenPaths.add(resolved)

    const parent = input.mountPoint ?? resolved
    const probe = await probeMount(parent)
    const option: StorageVolumeOption = {
      id: input.id,
      label: volumeLabel(input.kind, input.mountPoint ?? resolved, input.filesystem ?? null),
      arciinPath: resolved,
      mountPoint: input.mountPoint,
      kind: input.kind,
      filesystem: input.filesystem ?? null,
      device: input.device ?? null,
      totalBytes: probe.totalBytes,
      availableBytes: probe.availableBytes,
      writable: probe.writable,
      recommended: Boolean(input.recommended),
      largeExternal: Boolean(input.largeExternal),
    }
    volumes.push(option)
  }

  await addOption({
    id: "recommended",
    arciinPath: recommended,
    mountPoint: path.dirname(recommended),
    kind: "recommended",
    recommended: true,
  })

  if (docker) {
    await addOption({
      id: "runtime",
      arciinPath: runtimeDataDir,
      mountPoint: runtimeDataDir,
      kind: "runtime",
      filesystem: null,
      device: null,
    })
  } else if (resolvedDistinct(runtimeDataDir, recommended)) {
    await addOption({
      id: "runtime",
      arciinPath: runtimeDataDir,
      mountPoint: runtimeDataDir,
      kind: "runtime",
    })
  }

  const mounts = await parseLinuxMounts()
  const mountCandidates = mounts
    .filter((m) => {
      if (m.mountPoint === "/") return true
      return (
        m.mountPoint.startsWith("/mnt/") ||
        m.mountPoint.startsWith("/media/") ||
        m.mountPoint.startsWith("/srv/") ||
        m.mountPoint.startsWith("/run/media/")
      )
    })
    .sort((a, b) => {
      const score = (mp: string) => {
        if (mp === "/") return 0
        if (mp.startsWith("/srv/")) return 3
        if (mp.startsWith("/mnt/")) return 2
        if (mp.startsWith("/media/") || mp.startsWith("/run/media/")) return 2
        return 1
      }
      return score(b.mountPoint) - score(a.mountPoint)
    })

  for (const mount of mountCandidates) {
    const arciinPath = arciinPathForMount(mount.mountPoint)
    const probe = await probeMount(mount.mountPoint)
    const available = probe.availableBytes ?? 0
    const largeExternal =
      mount.mountPoint !== "/" &&
      available > osAvailable * 1.25 &&
      (probe.totalBytes ?? 0) > 8 * 1024 * 1024 * 1024

    await addOption({
      id: `mount-${mount.mountPoint.replace(/[^a-zA-Z0-9]+/g, "-")}`,
      arciinPath,
      mountPoint: mount.mountPoint,
      kind: mount.mountPoint === "/" ? "os-root" : "mount",
      filesystem: mount.filesystem,
      device: mount.device,
      largeExternal,
      recommended: largeExternal && !docker,
    })
  }

  volumes.sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1
    if (a.largeExternal !== b.largeExternal) return a.largeExternal ? -1 : 1
    return (b.availableBytes ?? 0) - (a.availableBytes ?? 0)
  })

  const installNotes: string[] = []
  if (docker) {
    installNotes.push(
      "Docker stores files at /data/arciin inside containers. Set ARCIIN_HOST_DATA_DIR on the host (default /srv/arciin-storage/arciin) and re-run ./scripts/docker-setup.sh to bind-mount a larger disk.",
    )
    if (host) {
      installNotes.push(`Host folder from .env: ${host}`)
    }
  } else {
    installNotes.push(
      "Pick a path on a disk with enough free space. Run ./install.sh on the server for interactive SSD detection, optional formatting, and migration.",
    )
  }

  const largest = volumes.find((v) => v.largeExternal)
  if (largest && largest.arciinPath !== recommended) {
    installNotes.push(
      `Detected more space on ${largest.mountPoint ?? largest.arciinPath} (${formatBytesShort(largest.availableBytes)} free) — consider using ${largest.arciinPath}.`,
    )
  }

  return {
    runtimeDataDir,
    hostDataDir: host,
    isDockerRuntime: docker,
    recommendedArciinPath: recommended,
    osRoot: {
      mountPoint: "/",
      totalBytes: osProbe.totalBytes,
      availableBytes: osProbe.availableBytes,
    },
    volumes,
    installNotes,
  }
}

function resolvedDistinct(a: string, b: string): boolean {
  return path.resolve(a) !== path.resolve(b)
}

function formatBytesShort(bytes: number | null): string {
  if (bytes == null || bytes < 0) return "unknown"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

const ALLOWED_PREPARE_PREFIXES = ["/srv/", "/mnt/", "/media/", "/run/media/", "/data/"]

export async function prepareStoragePathForSetup(requestedPath: string): Promise<{
  arciinPath: string
  writable: boolean
}> {
  const resolved = path.resolve(requestedPath.trim())
  if (!resolved.startsWith("/") || resolved.includes("..")) {
    throw new Error("INVALID_PATH")
  }
  if (!ALLOWED_PREPARE_PREFIXES.some((prefix) => resolved.startsWith(prefix))) {
    throw new Error("PATH_NOT_ALLOWED")
  }

  await mkdir(resolved, { recursive: true })
  await ensureStorageDirectories(resolved)
  const { writable } = await probeStorageRoot(resolved)
  return { arciinPath: resolved, writable }
}
