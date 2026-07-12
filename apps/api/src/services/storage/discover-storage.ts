import { execFile } from "node:child_process"
import fs from "node:fs"
import { access, mkdir, readFile, statfs } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

import { ARCIIN_DEFAULT_STORAGE_ROOT } from "@arciin/shared"

import { apiConfig } from "@/config"
import { assertStorageWritable, ensureStorageDirectories, probeStorageRoot } from "@/services/storage/local-storage"

export type StorageVolumeOption = {
  id: string
  label: string
  arciinPath: string
  mountPoint: string | null
  kind: "recommended" | "mount" | "runtime" | "os-root" | "custom" | "unmounted"
  filesystem: string | null
  device: string | null
  totalBytes: number | null
  availableBytes: number | null
  writable: boolean
  recommended: boolean
  /** Larger than OS root and good candidate for media */
  largeExternal: boolean
  isCurrent?: boolean
  sameDiskAsCurrent?: boolean
}

export type UnmountedBlockDevice = {
  id: string
  device: string
  name: string
  sizeLabel: string
  sizeBytes: number | null
  filesystem: string | null
  /** LUKS-encrypted volume — needs a disk encryption password before mount. */
  isLuks: boolean
  /** No usable filesystem detected (ext4/xfs/etc.) — format required before mount. */
  needsFormat: boolean
  type: "disk" | "part"
  suggestedMountPoint: string
  suggestedArciinPath: string
  model?: string | null
  transport?: string | null
}

export type CurrentStorageDeviceContext = {
  mountDevice: string | null
  mountPoint: string | null
  filesystemTotalBytes: number | null
  filesystemAvailableBytes: number | null
  blockDevice: string | null
  blockDeviceSizeBytes: number | null
  blockDeviceModel: string | null
  blockDeviceTransport: string | null
}

export type StorageBlockDisk = {
  id: string
  device: string
  name: string
  sizeLabel: string
  sizeBytes: number | null
  model: string | null
  transport: string | null
  role: "system" | "attached" | "internal"
  unmountedPartitionCount: number
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
  /** Block devices visible to lsblk but not mounted (mount on the host, then Rescan). */
  unmountedDevices: UnmountedBlockDevice[]
  /** Physical disks detected on the server (NVMe, SD, USB, etc.). */
  blockDisks: StorageBlockDisk[]
  /** Where Arciin data lives vs the underlying physical disk size. */
  currentDeviceContext: CurrentStorageDeviceContext | null
  /** False when the API user must supply a sudo password to mount disks from the UI. */
  mountPasswordlessSudo: boolean
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

async function detectMountPasswordlessSudo(): Promise<boolean> {
  if (isDockerRuntime()) return false
  try {
    await execFileAsync("sudo", ["-n", "true"], { timeout: 5000 })
    return true
  } catch {
    return false
  }
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

export type ParsedMount = {
  device: string
  mountPoint: string
  filesystem: string
}

export async function parseLinuxMounts(): Promise<ParsedMount[]> {
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

function mountIdentityKey(mount: ParsedMount): string {
  return `${mount.device}::${mount.mountPoint}`
}

/** Longest matching mount from /proc/mounts for a path (real filesystem, not each folder). */
export function findContainingMount(mounts: ParsedMount[], filePath: string): ParsedMount | null {
  const resolved = path.resolve(filePath)
  let best: ParsedMount | null = null
  let bestLen = -1

  for (const m of mounts) {
    const mp = m.mountPoint
    const matches =
      resolved === mp ||
      (mp !== "/" && resolved.startsWith(`${mp}/`)) ||
      (mp === "/" && resolved.startsWith("/"))
    if (matches && mp.length > bestLen) {
      best = m
      bestLen = mp.length
    }
  }

  return best
}

function pickBestRelocateTarget(options: StorageVolumeOption[]): StorageVolumeOption {
  return [...options].sort((a, b) => {
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1
    if (a.kind === "recommended") return -1
    if (b.kind === "recommended") return 1
    if (a.largeExternal !== b.largeExternal) return a.largeExternal ? -1 : 1
    return (b.availableBytes ?? 0) - (a.availableBytes ?? 0)
  })[0]!
}

/**
 * One entry per physical volume. Keeps the active path plus at most one alternate
 * folder on the same disk (e.g. repo path vs /srv/arciin-storage/arciin on /).
 */
export function consolidateStorageVolumes(
  volumes: StorageVolumeOption[],
  mounts: ParsedMount[],
  effectiveRoot: string,
): StorageVolumeOption[] {
  const currentResolved = path.resolve(effectiveRoot)
  const currentMount = findContainingMount(mounts, currentResolved)
  const currentMountKey = currentMount
    ? mountIdentityKey(currentMount)
    : `path:${currentResolved}`

  const groups = new Map<string, StorageVolumeOption[]>()
  for (const volume of volumes) {
    const mount = findContainingMount(mounts, volume.arciinPath)
    const key = mount ? mountIdentityKey(mount) : `path:${path.resolve(volume.arciinPath)}`
    const list = groups.get(key) ?? []
    list.push(volume)
    groups.set(key, list)
  }

  const consolidated: StorageVolumeOption[] = []

  for (const [key, group] of groups) {
    const currentVol =
      group.find((v) => path.resolve(v.arciinPath) === currentResolved) ?? null

    const others = group.filter((v) => v !== currentVol)
    if (currentVol) {
      consolidated.push(currentVol)
    }

    if (others.length === 0) continue

    const best = pickBestRelocateTarget(others)
    if (currentVol && path.resolve(best.arciinPath) === path.resolve(currentVol.arciinPath)) {
      continue
    }

    const sameDisk = key === currentMountKey
    consolidated.push({
      ...best,
      mountPoint: findContainingMount(mounts, best.arciinPath)?.mountPoint ?? best.mountPoint,
      device: findContainingMount(mounts, best.arciinPath)?.device ?? best.device,
      sameDiskAsCurrent: sameDisk,
      largeExternal: sameDisk ? false : best.largeExternal,
      label: sameDisk
        ? best.kind === "recommended"
          ? "Same disk — recommended folder outside the app"
          : `Same disk — ${best.arciinPath}`
        : best.label,
    })
  }

  consolidated.sort((a, b) => {
    if (a.isCurrent) return -1
    if (b.isCurrent) return 1
    if (a.recommended !== b.recommended) return a.recommended ? -1 : 1
    if (a.largeExternal !== b.largeExternal) return a.largeExternal ? -1 : 1
    return (b.availableBytes ?? 0) - (a.availableBytes ?? 0)
  })

  return consolidated
}

function volumeLabel(
  kind: StorageVolumeOption["kind"],
  mountPoint: string,
  filesystem: string | null,
  docker: boolean,
): string {
  if (kind === "recommended") {
    return docker
      ? "Host folder on disk (recommended)"
      : "Recommended — outside the app folder"
  }
  if (kind === "runtime") return "Container path (same data as host folder)"
  if (kind === "unmounted") return "Not mounted yet"
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
    if (host && resolved === runtime) return false
    if (effective === runtime && host && resolved === host) return true
  }

  return false
}

function parseLsblkSizeBytes(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const match = trimmed.match(/^([\d.]+)\s*([KMGTPE])?B?$/i)
  if (!match) return null
  const value = Number(match[1])
  const unit = (match[2] ?? "B").toUpperCase()
  const mult: Record<string, number> = {
    B: 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
    T: 1024 ** 4,
    P: 1024 ** 5,
    E: 1024 ** 6,
  }
  return Math.round(value * (mult[unit] ?? 1))
}

type LsblkJsonNode = {
  name?: string
  size?: string | number | null
  type?: string | null
  mountpoint?: string | null
  fstype?: string | null
  pkname?: string | null
  model?: string | null
  tran?: string | null
  children?: LsblkJsonNode[]
}

type LsblkInventoryRow = {
  name: string
  sizeLabel: string
  sizeBytes: number | null
  type: string
  mount: string
  fstype: string
  pkname: string
  model: string | null
  transport: string | null
}

function flattenLsblkNodes(nodes: LsblkJsonNode[], out: LsblkJsonNode[] = []): LsblkJsonNode[] {
  for (const node of nodes) {
    out.push(node)
    if (node.children?.length) flattenLsblkNodes(node.children, out)
  }
  return out
}

function lsblkNodeSizeLabel(node: LsblkJsonNode): string {
  if (typeof node.size === "number") return formatBytesShort(node.size)
  if (typeof node.size === "string" && node.size.trim()) return node.size.trim()
  return "?"
}

function lsblkNodeSizeBytes(node: LsblkJsonNode): number | null {
  if (typeof node.size === "number") return node.size
  if (typeof node.size === "string") return parseLsblkSizeBytes(node.size)
  return null
}

async function readLsblkInventory(): Promise<LsblkInventoryRow[]> {
  const { stdout } = await execFileAsync(
    "lsblk",
    ["-J", "-o", "NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,PKNAME,MODEL,TRAN"],
    { timeout: 8000, maxBuffer: 512 * 1024 },
  )
  const parsed = JSON.parse(stdout) as { blockdevices?: LsblkJsonNode[] }
  const nodes = flattenLsblkNodes(parsed.blockdevices ?? [])
  const rows: LsblkInventoryRow[] = []

  for (const node of nodes) {
    const name = node.name?.trim()
    const type = node.type?.trim()
    if (!name || !type) continue
    if (name.startsWith("loop")) continue
    rows.push({
      name,
      sizeLabel: lsblkNodeSizeLabel(node),
      sizeBytes: lsblkNodeSizeBytes(node),
      type,
      mount: node.mountpoint?.trim() ?? "",
      fstype: node.fstype?.trim() ?? "",
      pkname: node.pkname?.trim() ?? "",
      model: node.model?.trim() || null,
      transport: node.tran?.trim() || null,
    })
  }

  return rows
}

function rowByName(rows: LsblkInventoryRow[], name: string): LsblkInventoryRow | null {
  return rows.find((row) => row.name === name) ?? null
}

const USABLE_MOUNT_FILESYSTEMS = new Set([
  "ext4",
  "xfs",
  "btrfs",
  "ntfs",
  "exfat",
  "vfat",
])

export function isUsableBlockFilesystem(fstype: string | null | undefined): boolean {
  if (!fstype) return false
  if (/^crypto_LUKS/i.test(fstype)) return false
  if (fstype === "LVM2_member") return false
  return USABLE_MOUNT_FILESYSTEMS.has(fstype.toLowerCase())
}

/** lsblk LVM nodes live under /dev/mapper, not /dev/<name>. */
export function blockDevicePathForRow(row: Pick<LsblkInventoryRow, "name" | "type">): string {
  if (row.type === "lvm") return `/dev/mapper/${row.name}`
  return `/dev/${row.name}`
}

function resolvePhysicalDiskRow(
  rows: LsblkInventoryRow[],
  devicePath: string | null | undefined,
): LsblkInventoryRow | null {
  if (!devicePath) return null
  const normalized = devicePath.replace(/^\/dev\//, "").replace(/^\/dev\/mapper\//, "")
  let current = rowByName(rows, normalized)
  if (!current && devicePath.startsWith("/dev/mapper/")) {
    current = rowByName(rows, path.basename(devicePath))
  }
  if (!current) return null

  let safety = 0
  while (current && current.type !== "disk" && safety < 8) {
    if (!current.pkname) break
    current = rowByName(rows, current.pkname)
    safety += 1
  }
  return current?.type === "disk" ? current : null
}

function diskRole(row: LsblkInventoryRow, rows: LsblkInventoryRow[]): StorageBlockDisk["role"] {
  if (row.name === "nvme0n1" || row.transport === "nvme") return "system"
  if (row.name.startsWith("mmcblk0") || row.transport === "usb") return "attached"
  if (row.name.startsWith("mmcblk") || row.transport === "mmc") return "internal"
  return "attached"
}

function countUnmountedPartitionsOnDisk(diskName: string, rows: LsblkInventoryRow[]): number {
  return rows.filter((row) => {
    if (row.mount) return false
    if (row.fstype === "LVM2_member") return false
    if (row.sizeBytes != null && row.sizeBytes < 4 * 1024 * 1024 * 1024) return false
    if (row.type === "part" && row.pkname === diskName) return true
    if (row.type === "lvm") {
      const physical = resolvePhysicalDiskRow(rows, blockDevicePathForRow(row))
      return physical?.name === diskName
    }
    return false
  }).length
}

function discoverBlockDisks(rows: LsblkInventoryRow[]): StorageBlockDisk[] {
  return rows
    .filter(
      (row) =>
        row.type === "disk" &&
        !/boot\d*$/i.test(row.name) &&
        (row.sizeBytes ?? 0) >= 256 * 1024 * 1024,
    )
    .map((row) => ({
      id: `disk-${row.name}`,
      device: `/dev/${row.name}`,
      name: row.name,
      sizeLabel: row.sizeLabel,
      sizeBytes: row.sizeBytes,
      model: row.model,
      transport: row.transport,
      role: diskRole(row, rows),
      unmountedPartitionCount: countUnmountedPartitionsOnDisk(row.name, rows),
    }))
    .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0))
}

function discoverCurrentStorageDeviceContext(
  rows: LsblkInventoryRow[],
  mounts: ParsedMount[],
  storageRoot: string,
): CurrentStorageDeviceContext | null {
  const containing = findContainingMount(mounts, storageRoot)
  if (!containing) return null

  const physical = resolvePhysicalDiskRow(rows, containing.device)

  return {
    mountDevice: containing.device,
    mountPoint: containing.mountPoint,
    filesystemTotalBytes: null,
    filesystemAvailableBytes: null,
    blockDevice: physical ? `/dev/${physical.name}` : null,
    blockDeviceSizeBytes: physical?.sizeBytes ?? null,
    blockDeviceModel: physical?.model ?? null,
    blockDeviceTransport: physical?.transport ?? null,
  }
}

/** Disks/partitions from lsblk that have no mount point (SSD must be mounted before Arciin can use them). */
export async function discoverUnmountedBlockDevices(options?: {
  storageRoot?: string
  inventory?: LsblkInventoryRow[]
}): Promise<UnmountedBlockDevice[]> {
  try {
    const allRows = (options?.inventory ?? (await readLsblkInventory())).filter(
      (row) => row.type === "disk" || row.type === "part" || row.type === "lvm",
    )

    const disksWithPartitions = new Set<string>()
    for (const row of allRows) {
      if (row.type !== "part") continue
      if (row.pkname) {
        disksWithPartitions.add(row.pkname)
        continue
      }
      for (const disk of allRows) {
        if (disk.type === "disk" && row.name.startsWith(`${disk.name}`)) {
          disksWithPartitions.add(disk.name)
        }
      }
    }

    const excludedNames = new Set<string>()
    if (options?.storageRoot) {
      const mounts = await parseLinuxMounts()
      const containing = findContainingMount(mounts, options.storageRoot)
      if (containing) {
        const dev = containing.device.replace(/^\/dev\//, "")
        excludedNames.add(dev)
        const row = allRows.find((r) => r.name === dev)
        if (row?.pkname) {
          excludedNames.add(row.pkname)
        } else {
          for (const disk of allRows) {
            if (disk.type === "disk" && dev.startsWith(disk.name)) {
              excludedNames.add(disk.name)
            }
          }
        }
      }
    }

    const filtered = allRows.filter((row) => {
      if (row.mount) return false
      if (excludedNames.has(row.name)) return false
      if (row.type === "disk" && disksWithPartitions.has(row.name)) return false
      if (/boot/i.test(row.name)) return false
      if (row.fstype === "LVM2_member") return false
      if (row.type === "lvm" && !isUsableBlockFilesystem(row.fstype)) return false
      if (row.sizeBytes != null && row.sizeBytes < 4 * 1024 * 1024 * 1024) return false
      return true
    })

    return filtered.map((row) => {
      const mountSlug = row.name.replace(/[^a-zA-Z0-9]+/g, "-")
      const suggestedMountPoint = `/mnt/arciin-${mountSlug}`
      const fstype = row.fstype || null
      const isLuks = Boolean(fstype && /^crypto_LUKS/i.test(fstype))
      const parentDisk = row.pkname
        ? rowByName(allRows, row.pkname)
        : row.type === "lvm"
          ? resolvePhysicalDiskRow(allRows, blockDevicePathForRow(row))
          : null
      const blockType: UnmountedBlockDevice["type"] =
        row.type === "disk" ? "disk" : row.type === "lvm" ? "part" : "part"
      return {
        id: `unmounted-${row.name}`,
        device: blockDevicePathForRow(row),
        name: row.name,
        sizeLabel: row.sizeLabel,
        sizeBytes: row.sizeBytes,
        filesystem: fstype,
        isLuks,
        needsFormat: !isLuks && !isUsableBlockFilesystem(fstype),
        type: blockType,
        suggestedMountPoint,
        suggestedArciinPath: path.join(suggestedMountPoint, ARCIIN_SUBDIR),
        model: parentDisk?.model ?? row.model,
        transport: parentDisk?.transport ?? row.transport,
      }
    })
  } catch {
    return []
  }
}

export function filterClientStorageVolumes(
  volumes: StorageVolumeOption[],
  discovery: Pick<StorageDiscovery, "isDockerRuntime" | "hostDataDir" | "runtimeDataDir">,
): StorageVolumeOption[] {
  const host = discovery.hostDataDir ? path.resolve(discovery.hostDataDir) : null
  const runtime = path.resolve(discovery.runtimeDataDir)

  return volumes.filter((v) => {
    if (v.kind === "unmounted") return false
    if (discovery.isDockerRuntime && v.kind === "runtime") return false
    if (
      discovery.isDockerRuntime &&
      host &&
      v.kind === "recommended" &&
      path.resolve(v.arciinPath) === host
    ) {
      return true
    }
    if (
      discovery.isDockerRuntime &&
      host &&
      path.resolve(v.arciinPath) === runtime
    ) {
      return false
    }
    return true
  })
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
    if (v.sameDiskAsCurrent) return false
    if (v.kind === "os-root" || v.kind === "runtime") return false
    return v.writable !== false
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
  const mounts = await parseLinuxMounts()

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
      label: volumeLabel(
        input.kind,
        input.mountPoint ?? resolved,
        input.filesystem ?? null,
        docker,
      ),
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
    filesystem: findContainingMount(mounts, recommended)?.filesystem ?? null,
    device: findContainingMount(mounts, recommended)?.device ?? null,
  })

  if (!docker && resolvedDistinct(runtimeDataDir, recommended)) {
    await addOption({
      id: "runtime",
      arciinPath: runtimeDataDir,
      mountPoint: runtimeDataDir,
      kind: "runtime",
    })
  }

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

  const inventory = await readLsblkInventory()
  const unmountedDevices = await discoverUnmountedBlockDevices({
    storageRoot: runtimeDataDir,
    inventory,
  })
  const blockDisks = discoverBlockDisks(inventory)
  const mountPasswordlessSudo = await detectMountPasswordlessSudo()

  const currentMountForContext = findContainingMount(mounts, runtimeDataDir)
  const currentDeviceContext = discoverCurrentStorageDeviceContext(
    inventory,
    mounts,
    runtimeDataDir,
  )
  if (currentDeviceContext && currentMountForContext) {
    const probe = await probeMount(currentMountForContext.mountPoint)
    currentDeviceContext.filesystemTotalBytes = probe.totalBytes
    currentDeviceContext.filesystemAvailableBytes = probe.availableBytes
  }

  const installNotes: string[] = []
  if (docker) {
    installNotes.push(
      "Files are stored on the host at ARCIIN_HOST_DATA_DIR (shown below). /data/arciin inside containers is the same folder — not a second disk.",
    )
    installNotes.push(
      "To use a larger SSD: mount it on the host, set ARCIIN_HOST_DATA_DIR to that folder, re-run ./scripts/docker-setup.sh, then transfer below.",
    )
    if (host) {
      installNotes.push(`Host folder from .env: ${host}`)
    }
  } else {
    installNotes.push(
      "Pick a path on a disk with enough free space. Run ./install.sh on the server for interactive SSD detection, optional formatting, and migration.",
    )
  }

  const mountsForNotes = await parseLinuxMounts()
  const currentMountForNotes = findContainingMount(mountsForNotes, runtimeDataDir)
  const largest = volumes.find((v) => {
    if (!v.largeExternal) return false
    const m = findContainingMount(mountsForNotes, v.arciinPath)
    if (!m || !currentMountForNotes) return true
    return mountIdentityKey(m) !== mountIdentityKey(currentMountForNotes)
  })
  if (largest && largest.arciinPath !== recommended) {
    installNotes.push(
      `Detected more space on ${largest.mountPoint ?? largest.arciinPath} (${formatBytesShort(largest.availableBytes)} free) — consider using ${largest.arciinPath}.`,
    )
  }

  if (currentDeviceContext?.blockDeviceSizeBytes && currentDeviceContext.filesystemTotalBytes) {
    if (currentDeviceContext.blockDeviceSizeBytes > currentDeviceContext.filesystemTotalBytes * 1.1) {
      const diskLabel =
        currentDeviceContext.blockDeviceModel?.trim() ||
        currentDeviceContext.blockDevice ||
        "the physical disk"
      installNotes.push(
        `Arciin currently uses a ${formatBytesShort(currentDeviceContext.filesystemTotalBytes)} filesystem on ${currentMountForContext?.device ?? "this server"}. The underlying ${diskLabel} is ${formatBytesShort(currentDeviceContext.blockDeviceSizeBytes)} — mount attached storage below or expand system storage to use the rest.`,
      )
    }
  }

  const attachedDisks = blockDisks.filter((disk) => disk.role === "attached")
  if (attachedDisks.length > 0) {
    installNotes.push(
      `Detected ${attachedDisks.length} attached storage device${attachedDisks.length === 1 ? "" : "s"}: ${attachedDisks.map((disk) => `${disk.sizeLabel}${disk.model ? ` (${disk.model})` : ""}`).join(", ")}.`,
    )
  }

  if (unmountedDevices.length > 0) {
    installNotes.push(
      `${unmountedDevices.length} unmounted partition${unmountedDevices.length === 1 ? "" : "s"} ready to mount below (for example ${unmountedDevices[0]!.device}).`,
    )
  }

  const clientVolumes = filterClientStorageVolumes(volumes, {
    isDockerRuntime: docker,
    hostDataDir: host,
    runtimeDataDir,
  })

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
    volumes: clientVolumes,
    unmountedDevices,
    blockDisks,
    currentDeviceContext,
    mountPasswordlessSudo,
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
