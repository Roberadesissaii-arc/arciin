/**
 * Which block devices may be offered as somewhere to keep a library.
 *
 * Deliberately free of imports so the rules can be asserted against fixtures
 * without lsblk, a config module or a running instance — and so there is
 * exactly one place they live.
 *
 * They used to live in two. Settings → Attached disks said "1 partition needs
 * mounting" on the 58 GB internal drive while offering nothing to select: the
 * count and the selectable list were worked out separately, and the list
 * additionally dropped anything in an exclusion set and anything whose name
 * matched /boot/. A phantom candidate the user could not act on.
 */

export type BlockRow = {
  name: string
  sizeBytes: number | null
  type: string
  mount: string
  fstype: string
  pkname: string
}

/** Smallest partition worth offering. */
export const MIN_CANDIDATE_BYTES = 4 * 1024 * 1024 * 1024

const USABLE_MOUNT_FILESYSTEMS = new Set(["ext4", "xfs", "btrfs", "ntfs", "exfat", "vfat"])

export function isUsableBlockFilesystem(fstype: string | null | undefined): boolean {
  if (!fstype) return false
  if (/^crypto_LUKS/i.test(fstype)) return false
  // A physical volume is not itself mountable; its logical volumes are.
  if (fstype === "LVM2_member") return false
  return USABLE_MOUNT_FILESYSTEMS.has(fstype.toLowerCase())
}

/** lsblk LVM nodes live under /dev/mapper, not /dev/<name>. */
export function blockDevicePathForRow(row: Pick<BlockRow, "name" | "type">): string {
  if (row.type === "lvm") return `/dev/mapper/${row.name}`
  return `/dev/${row.name}`
}

export function rowByName<T extends BlockRow>(rows: T[], name: string): T | null {
  return rows.find((row) => row.name === name) ?? null
}

/**
 * The lsblk row for a device path, however the path is spelled.
 *
 * /dev/mapper/<lv>, /dev/<vg>/<lv> and /dev/<name> all reach the same row.
 * The storage exclusion used to strip only a leading "/dev/", so a root on
 * /dev/mapper/ubuntu--vg-ubuntu--lv became "mapper/ubuntu--vg-ubuntu--lv" — a
 * string matching no row and no disk-name prefix — and the guard quietly
 * excluded nothing at all.
 */
export function rowForDevicePath<T extends BlockRow>(
  rows: T[],
  devicePath: string | null | undefined,
): T | null {
  if (!devicePath?.trim()) return null
  const raw = devicePath.trim()

  const direct = rows.find((row) => blockDevicePathForRow(row) === raw)
  if (direct) return direct

  const base = raw.replace(/\/+$/, "").split("/").pop() ?? ""
  if (!base) return null
  return rows.find((row) => row.name === base) ?? null
}

/** Walk up to the physical disk a row ultimately sits on. */
export function resolvePhysicalDiskRow<T extends BlockRow>(
  rows: T[],
  devicePath: string | null | undefined,
): T | null {
  let current = rowForDevicePath(rows, devicePath)
  if (!current) return null

  let safety = 0
  while (current && current.type !== "disk" && safety < 8) {
    if (!current.pkname) break
    current = rowByName(rows, current.pkname)
    safety += 1
  }
  return current?.type === "disk" ? current : null
}

export type EligibilityContext = {
  /** Devices already carrying Arciin's storage. */
  excludedNames?: ReadonlySet<string>
  disksWithPartitions?: ReadonlySet<string>
}

export function isEligibleMountCandidate(
  row: BlockRow,
  context: EligibilityContext = {},
): boolean {
  if (row.mount) return false
  if (context.excludedNames?.has(row.name)) return false
  if (row.type === "disk" && context.disksWithPartitions?.has(row.name)) return false
  // EFI and /boot belong to the OS, not to a media library.
  if (/boot/i.test(row.name)) return false
  if (row.fstype === "LVM2_member") return false
  if (row.type === "lvm" && !isUsableBlockFilesystem(row.fstype)) return false
  if (row.sizeBytes != null && row.sizeBytes < MIN_CANDIDATE_BYTES) return false
  return true
}

/**
 * The eligible candidates living on one physical disk.
 *
 * The count shown on a disk row and the list offered beneath it both come from
 * here, so they cannot disagree.
 */
export function eligibleMountCandidatesOnDisk<T extends BlockRow>(
  diskName: string,
  rows: T[],
  context: EligibilityContext = {},
): T[] {
  return rows.filter((row) => {
    if (!isEligibleMountCandidate(row, context)) return false
    if (row.type === "part" && row.pkname === diskName) return true
    if (row.type === "lvm") {
      return resolvePhysicalDiskRow(rows, blockDevicePathForRow(row))?.name === diskName
    }
    return false
  })
}
