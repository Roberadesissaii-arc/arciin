import { describe, expect, it } from "vitest"

import {
  blockDevicePathForRow,
  eligibleMountCandidatesOnDisk,
  isEligibleMountCandidate,
  isUsableBlockFilesystem,
  rowForDevicePath,
} from "../apps/api/src/services/storage/mount-eligibility"

/**
 * Settings → Attached disks said "1 partition needs mounting" on the 58 GB
 * internal drive while offering nothing to select.
 *
 * The count and the list were worked out separately. The list additionally
 * dropped anything in an exclusion set and anything whose name matched /boot/;
 * the count did not. A phantom candidate the user could not act on.
 *
 * Fixtures mirror this host: a 238 GB NVMe carrying the system, a 58 GB eMMC
 * with an unmounted ext4 logical volume, and a 29 GB SD card.
 */

type Row = Parameters<typeof isEligibleMountCandidate>[0]

const row = (over: Partial<Row> & Pick<Row, "name" | "type">): Row =>
  ({
    mount: "",
    fstype: "",
    sizeBytes: 64 * 1024 * 1024 * 1024,
    pkname: "",
    sizeLabel: "",
    model: "",
    transport: "",
    ...over,
  }) as Row

const GIB = 1024 ** 3

const rows: Row[] = [
  row({ name: "nvme0n1", type: "disk", sizeBytes: 238 * GIB }),
  row({ name: "nvme0n1p1", type: "part", pkname: "nvme0n1", fstype: "vfat", sizeBytes: GIB, mount: "/boot/efi" }),
  row({ name: "nvme0n1p2", type: "part", pkname: "nvme0n1", fstype: "ext4", sizeBytes: 2 * GIB, mount: "/boot" }),
  row({ name: "nvme0n1p3", type: "part", pkname: "nvme0n1", fstype: "LVM2_member", sizeBytes: 235 * GIB }),
  row({ name: "ubuntu--vg-ubuntu--lv", type: "lvm", fstype: "ext4", sizeBytes: 100 * GIB, mount: "/" }),

  row({ name: "mmcblk1", type: "disk", sizeBytes: 58 * GIB }),
  row({ name: "mmcblk1p1", type: "part", pkname: "mmcblk1", fstype: "vfat", sizeBytes: GIB }),
  row({ name: "mmcblk1p2", type: "part", pkname: "mmcblk1", fstype: "ext4", sizeBytes: 2 * GIB }),
  row({ name: "mmcblk1p3", type: "part", pkname: "mmcblk1", fstype: "LVM2_member", sizeBytes: 55 * GIB }),
  row({ name: "ubuntu--vg--1-ubuntu--lv", type: "lvm", fstype: "ext4", sizeBytes: 27 * GIB, pkname: "mmcblk1p3" }),

  row({ name: "mmcblk0", type: "disk", sizeBytes: 29 * GIB }),
  row({ name: "mmcblk0p1", type: "part", pkname: "mmcblk0", fstype: "ext4", sizeBytes: 29 * GIB }),
]

describe("what may be offered as somewhere to keep a library", () => {
  const cases: Array<[string, string, boolean]> = [
    ["an unmounted ext4 partition", "mmcblk0p1", true],
    ["an unmounted ext4 logical volume", "ubuntu--vg--1-ubuntu--lv", true],
    ["a mounted partition", "nvme0n1p2", false],
    ["the root logical volume", "ubuntu--vg-ubuntu--lv", false],
    ["the EFI partition", "nvme0n1p1", false],
    ["an LVM physical volume", "nvme0n1p3", false],
    ["a partition under the size floor", "mmcblk1p2", false],
    ["a vfat partition under the floor", "mmcblk1p1", false],
  ]

  it.each(cases)("%s -> %s", (_label, name, expected) => {
    const target = rows.find((r) => r.name === name)!
    expect(isEligibleMountCandidate(target)).toBe(expected)
  })

  it("rejects an unsupported filesystem on a logical volume", () => {
    const swap = row({ name: "vg-swap", type: "lvm", fstype: "swap", sizeBytes: 8 * GIB })
    expect(isEligibleMountCandidate(swap)).toBe(false)
    expect(isUsableBlockFilesystem("swap")).toBe(false)
  })

  it("honours the exclusion set", () => {
    const target = rows.find((r) => r.name === "mmcblk0p1")!
    expect(isEligibleMountCandidate(target)).toBe(true)
    expect(
      isEligibleMountCandidate(target, { excludedNames: new Set(["mmcblk0p1"]) }),
    ).toBe(false)
  })
})

describe("the count and the list cannot disagree", () => {
  it("the 58 GB internal drive offers exactly its logical volume", () => {
    const found = eligibleMountCandidatesOnDisk("mmcblk1", rows)
    expect(found.map((r) => r.name)).toEqual(["ubuntu--vg--1-ubuntu--lv"])
    // The number on the disk row is the length of the list beneath it.
    expect(found).toHaveLength(1)
  })

  it("the SD card offers its one partition", () => {
    expect(eligibleMountCandidatesOnDisk("mmcblk0", rows).map((r) => r.name)).toEqual([
      "mmcblk0p1",
    ])
  })

  it("the system disk offers nothing", () => {
    expect(eligibleMountCandidatesOnDisk("nvme0n1", rows)).toEqual([])
  })

  it("an excluded device disappears from the count as well as the list", () => {
    // Previously the exclusion reached only the list, so the count kept
    // advertising something that could not be selected.
    const context = { excludedNames: new Set(["ubuntu--vg--1-ubuntu--lv"]) }
    expect(eligibleMountCandidatesOnDisk("mmcblk1", rows, context)).toEqual([])
  })
})

describe("a device is found however its path is spelled", () => {
  it.each([
    ["/dev/mapper/ubuntu--vg-ubuntu--lv", "ubuntu--vg-ubuntu--lv"],
    ["/dev/ubuntu-vg/ubuntu--vg-ubuntu--lv", "ubuntu--vg-ubuntu--lv"],
    ["/dev/nvme0n1p3", "nvme0n1p3"],
    ["/dev/mmcblk0p1", "mmcblk0p1"],
  ])("%s resolves to %s", (path, expected) => {
    expect(rowForDevicePath(rows, path)?.name).toBe(expected)
  })

  it("builds mapper paths for logical volumes and plain paths otherwise", () => {
    expect(blockDevicePathForRow({ name: "vg-lv", type: "lvm" })).toBe("/dev/mapper/vg-lv")
    expect(blockDevicePathForRow({ name: "mmcblk0p1", type: "part" })).toBe("/dev/mmcblk0p1")
  })

  it("returns nothing for an unknown or empty path", () => {
    expect(rowForDevicePath(rows, "/dev/sdz9")).toBeNull()
    expect(rowForDevicePath(rows, "")).toBeNull()
    expect(rowForDevicePath(rows, null)).toBeNull()
  })

  it("the root device resolves, which is what the exclusion depends on", () => {
    // Stripping only "/dev/" left "mapper/ubuntu--vg-ubuntu--lv", which matched
    // no row and no disk prefix, so the guard excluded nothing at all.
    expect(rowForDevicePath(rows, "/dev/mapper/ubuntu--vg-ubuntu--lv")?.mount).toBe("/")
  })
})
