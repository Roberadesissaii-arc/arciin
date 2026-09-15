import { describe, expect, it } from "vitest"

import { countProtectedRoots } from "../apps/api/src/services/backup/serialize"
import {
  NEVER_SYNCED_ROOT_LABEL,
  computerHealthLabel,
  computerIsUpToDate,
  computerRootStatusLabel,
  isAwaitingFirstSync,
} from "../apps/web/lib/utils/computer-root-status"

/**
 * A protected folder the computer never actually backed up.
 *
 * Backup setup creates a SyncRoot server-side and it is PROTECTED immediately.
 * Nothing in the protocol asks the computer to confirm it took ownership, so a
 * root can sit on the server, be counted, and be labelled "Up to date" while
 * the client has no local record of it and not one byte has been uploaded.
 *
 * That happened: a "Games" root with 20,000+ files on disk, 1,070 enumerated
 * folders, fileCount 0, lastSyncAt null, and no local root on the computer —
 * presented to the user as fully protected and up to date.
 *
 * The evidence is `fileCount`, recomputed by the server from the root's ACTIVE
 * FILE entries. `SyncRoot.lastSyncAt` is the obvious candidate and is useless:
 * nothing writes it, so it is null on every root in production — including
 * TestBackup, api and avater, which hold 7, 14 and 80 files. Resting the label
 * on it would have called three genuinely backed-up folders "waiting".
 */

/** The Games root exactly as production held it: protected, and holding nothing. */
const serverOnlyRoot = { status: "PROTECTED", lastSyncAt: null, fileCount: 0 }
/** avater, as production holds it: protected, 80 files, and no lastSyncAt — like every root. */
const syncedRoot = { status: "PROTECTED", lastSyncAt: null, fileCount: 80 }

describe("CASE 1 — server root the computer never acknowledged", () => {
  it("is recognised as awaiting its first sync", () => {
    expect(isAwaitingFirstSync(serverOnlyRoot)).toBe(true)
  })

  it("must not say 'Up to date'", () => {
    expect(computerRootStatusLabel(serverOnlyRoot)).not.toBe("Up to date")
  })

  it("says it is waiting for the computer instead", () => {
    expect(computerRootStatusLabel(serverOnlyRoot)).toBe(NEVER_SYNCED_ROOT_LABEL)
  })
})

describe("CASE 2 — disabled roots", () => {
  it("are not counted as protected", () => {
    expect(
      countProtectedRoots([
        { status: "PROTECTED" },
        { status: "PROTECTED" },
        { status: "PROTECTED" },
        { status: "DISABLED" },
      ]),
    ).toBe(3)
  })

  it("read as Disabled, never as waiting or up to date", () => {
    const disabled = { status: "DISABLED", lastSyncAt: null, fileCount: 0 }
    expect(isAwaitingFirstSync(disabled)).toBe(false)
    expect(computerRootStatusLabel(disabled)).toBe("Disabled")
  })
})

describe("CASE 3 — a normal protected root that has synced", () => {
  it("still says 'Up to date'", () => {
    expect(computerRootStatusLabel(syncedRoot)).toBe("Up to date")
  })

  it("does not regress the other statuses", () => {
    expect(computerRootStatusLabel({ status: "SYNCING", lastSyncAt: null, fileCount: 0 })).toBe("Backing up")
    expect(computerRootStatusLabel({ status: "PAUSED", lastSyncAt: null, fileCount: 0 })).toBe("Paused")
    expect(computerRootStatusLabel({ status: "ERROR", lastSyncAt: null, fileCount: 0 })).toBe("Error")
  })
})

describe("CASE 4 — a computer carrying a server-only orphan root", () => {
  /** Production's profile: three real roots plus Games, profile health UP_TO_DATE. */
  const computer = {
    health: "UP_TO_DATE",
    roots: [syncedRoot, syncedRoot, syncedRoot, serverOnlyRoot],
  }

  it("is not certified up to date", () => {
    expect(computerIsUpToDate(computer)).toBe(false)
  })

  it("does not label the whole computer 'Up to date'", () => {
    expect(computerHealthLabel(computer)).toBe(NEVER_SYNCED_ROOT_LABEL)
  })

  it("is up to date once every root has synced", () => {
    const healthy = { health: "UP_TO_DATE", roots: [syncedRoot, syncedRoot, syncedRoot] }
    expect(computerIsUpToDate(healthy)).toBe(true)
    expect(computerHealthLabel(healthy)).toBe("Up to date")
  })

  it("a disabled orphan no longer holds the computer back", () => {
    const afterDisable = {
      health: "UP_TO_DATE",
      roots: [syncedRoot, syncedRoot, syncedRoot, { status: "DISABLED", lastSyncAt: null, fileCount: 0 }],
    }
    expect(computerIsUpToDate(afterDisable)).toBe(true)
    expect(computerHealthLabel(afterDisable)).toBe("Up to date")
  })

  it("never overrides a health that was already unhealthy", () => {
    expect(computerHealthLabel({ health: "ERROR", roots: [serverOnlyRoot] })).toBe("Error")
    expect(computerHealthLabel({ health: "OFFLINE", roots: [serverOnlyRoot] })).toBe("Offline")
  })
})

describe("the real roots on DESKTOP-S8FBLDB keep saying 'Up to date'", () => {
  // Resting this on lastSyncAt downgraded all three of these to "waiting",
  // because nothing writes SyncRoot.lastSyncAt. fileCount is what separates them.
  it.each([
    ["TestBackup", 7],
    ["api", 14],
    ["avater", 80],
  ])("%s (%i files)", (_name, fileCount) => {
    const root = { status: "PROTECTED", lastSyncAt: null, fileCount }
    expect(isAwaitingFirstSync(root)).toBe(false)
    expect(computerRootStatusLabel(root)).toBe("Up to date")
  })

  it("and the computer they belong to is up to date once Games is disabled", () => {
    const computer = {
      health: "UP_TO_DATE",
      roots: [
        { status: "PROTECTED", lastSyncAt: null, fileCount: 7 },
        { status: "PROTECTED", lastSyncAt: null, fileCount: 14 },
        { status: "PROTECTED", lastSyncAt: null, fileCount: 80 },
        { status: "DISABLED", lastSyncAt: null, fileCount: 0 },
      ],
    }
    expect(computerHealthLabel(computer)).toBe("Up to date")
  })
})

describe("CASE 5 — disabling the orphan through the lifecycle", () => {
  /** The nine roots on DESKTOP-S8FBLDB, with Games still protected. */
  const before = [
    { status: "PROTECTED" }, // TestBackup
    { status: "DISABLED" },  // OrderCheck
    { status: "DISABLED" },  // Pictures
    { status: "PROTECTED" }, // api
    { status: "DISABLED" },  // RootCycleTest
    { status: "DISABLED" },  // Desktop
    { status: "DISABLED" },  // ArciinWatcherTest
    { status: "PROTECTED" }, // avater
    { status: "PROTECTED" }, // Games
  ]

  it("counts 4 before the fix", () => {
    expect(countProtectedRoots(before)).toBe(4)
  })

  it("drops to 3 when Games is disabled, and nothing else moves", () => {
    const after = before.map((root, index) => (index === 8 ? { status: "DISABLED" } : root))
    expect(countProtectedRoots(after)).toBe(3)
    // Disabling is a status change only — the row count is untouched, which is
    // what keeps the historical entries and stored files in place.
    expect(after).toHaveLength(before.length)
  })
})
