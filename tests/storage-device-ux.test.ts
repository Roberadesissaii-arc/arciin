import { describe, expect, it } from "vitest"

import { describeRescan, transferBlockedReason } from "../apps/web/lib/storage/storage-device-ux"

describe("describeRescan", () => {
  const scan = { blockDisks: [{ id: "sda" }], unmountedDevices: [{ id: "mmcblk1p1" }], volumes: [{ id: "root" }] }

  it("says so when nothing changed", () => {
    expect(describeRescan(scan, scan).title).toBe("No new disks found.")
  })

  it("counts new disks and partitions", () => {
    const next = {
      blockDisks: [{ id: "sda" }, { id: "sdb" }],
      unmountedDevices: [{ id: "mmcblk1p1" }, { id: "sdb1" }],
      volumes: [{ id: "root" }],
    }
    const r = describeRescan(scan, next)
    expect(r.title).toBe("Storage devices refreshed.")
    expect(r.description).toContain("1 new disk")
    expect(r.description).toContain("1 new partition")
  })

  it("reports devices that went away", () => {
    const r = describeRescan(scan, { ...scan, unmountedDevices: [] })
    expect(r.title).toBe("Storage devices refreshed.")
    expect(r.description).toContain("1 no longer detected")
  })

  it("a first scan with no prior state is a refresh, not 'no new disks'", () => {
    expect(describeRescan(undefined, scan).title).toBe("Storage devices refreshed.")
  })
})

describe("transferBlockedReason", () => {
  const base = { active: false, pending: false, hasTarget: true, targetWritable: true, selectedUnmounted: false }

  it("null when a transfer can start", () => {
    expect(transferBlockedReason(base)).toBeNull()
  })

  it("an unmounted partition says to mount it", () => {
    expect(transferBlockedReason({ ...base, hasTarget: false, selectedUnmounted: true })).toBe(
      "Mount this partition before transferring Arciin storage.",
    )
  })

  it("no target, not writable, and running each have a reason", () => {
    expect(transferBlockedReason({ ...base, hasTarget: false })).toMatch(/Choose a mounted drive/)
    expect(transferBlockedReason({ ...base, targetWritable: false })).toMatch(/cannot write/)
    expect(transferBlockedReason({ ...base, active: true })).toMatch(/already running/)
  })
})
