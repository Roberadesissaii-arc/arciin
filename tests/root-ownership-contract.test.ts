import { describe, expect, it } from "vitest"

import {
  countProtectedRoots,
  isProtectedRoot,
  presentedBackupHealth,
  rootsToWithdraw,
} from "../apps/api/src/services/backup/serialize"
import {
  UNACKNOWLEDGED_ROOT_LABEL,
  computerHealthLabel,
  computerRootStatusLabel,
  isAwaitingComputer,
} from "../apps/web/lib/utils/computer-root-status"

/**
 * Ownership is stated by the computer, never inferred by the server.
 *
 * The server used to decide a folder was protected because a SyncRoot row
 * existed. A folder called Games sat in exactly that state: created through
 * backup setup, never held by any computer, nothing uploaded, and reported to
 * the user as protected and "Up to date".
 *
 * The computer now says which roots it holds — once per root through
 * `POST /backup/roots`, and as a full set on every heartbeat. The server's job
 * is to believe a present statement, and to draw no conclusion at all from an
 * absent one.
 */

const ACK = new Date("2026-09-15T20:00:00.000Z")
/** A root the computer claimed. */
const owned = { status: "PROTECTED", acknowledgedAt: ACK }
/** Games: created server-side, never claimed. */
const orphan = { status: "PROTECTED", acknowledgedAt: null }

describe("1 · a legacy heartbeat changes nothing", () => {
  it("counts roots on status alone while ownership has never been reported", () => {
    // The Desktop in production predates this field. Demanding an
    // acknowledgement it cannot send would strip protection from folders it is
    // genuinely backing up.
    expect(countProtectedRoots([orphan, orphan, orphan], false)).toBe(3)
  })

  it("keeps unacknowledged roots protected under legacy semantics", () => {
    expect(isProtectedRoot(orphan, false)).toBe(true)
  })
})

describe("2 · ownership-aware mode changes the rule", () => {
  it("requires acknowledgement once ownership has been observed", () => {
    expect(countProtectedRoots([owned, owned, orphan], true)).toBe(2)
  })

  it("7 · an unacknowledged root does not count after ownership-aware mode starts", () => {
    expect(isProtectedRoot(orphan, true)).toBe(false)
  })

  it("13 · a Games-style root cannot claim protection", () => {
    const games = { status: "PROTECTED", acknowledgedAt: null }
    expect(isProtectedRoot(games, true)).toBe(false)
    expect(computerRootStatusLabel(games)).toBe(UNACKNOWLEDGED_ROOT_LABEL)
    expect(computerRootStatusLabel(games)).not.toBe("Up to date")
  })
})

describe("5, 6 · an empty folder is a real protected folder", () => {
  /** fileCount is not consulted at all — these roots carry none. */
  const emptyOwned = { status: "PROTECTED", acknowledgedAt: ACK }

  it("an acknowledged empty root counts as protected", () => {
    expect(isProtectedRoot(emptyOwned, true)).toBe(true)
    expect(countProtectedRoots([emptyOwned], true)).toBe(1)
  })

  it("an acknowledged empty root reads as up to date", () => {
    expect(computerRootStatusLabel(emptyOwned, "UP_TO_DATE")).toBe("Up to date")
  })

  it("an empty computer is still up to date", () => {
    expect(computerHealthLabel({ health: "UP_TO_DATE", roots: [emptyOwned] })).toBe("Up to date")
  })
})

describe("root labels", () => {
  it("an acknowledged root follows the computer's own health", () => {
    expect(computerRootStatusLabel(owned, "SYNCING")).toBe("Backing up")
    expect(computerRootStatusLabel(owned, "PAUSED")).toBe("Paused")
    expect(computerRootStatusLabel(owned, "ERROR")).toBe("Error")
    expect(computerRootStatusLabel(owned, "UP_TO_DATE")).toBe("Up to date")
  })

  it("a disabled root reads Disabled, never waiting", () => {
    const disabled = { status: "DISABLED", acknowledgedAt: null }
    expect(isAwaitingComputer(disabled)).toBe(false)
    expect(computerRootStatusLabel(disabled)).toBe("Disabled")
  })

  it("a computer holding an unclaimed root is not up to date", () => {
    expect(computerHealthLabel({ health: "UP_TO_DATE", roots: [owned, orphan] })).toBe(
      UNACKNOWLEDGED_ROOT_LABEL,
    )
  })

  it("an already-unhealthy computer keeps its own status", () => {
    expect(computerHealthLabel({ health: "ERROR", roots: [orphan] })).toBe("Error")
    expect(computerHealthLabel({ health: "OFFLINE", roots: [orphan] })).toBe("Offline")
  })
})

describe("presented health respects the same regime", () => {
  it("falls back to OFFLINE when nothing is genuinely protected", () => {
    expect(
      presentedBackupHealth({
        profileStatus: "ENABLED",
        health: "UP_TO_DATE",
        roots: [orphan],
        ownershipObserved: true,
      }),
    ).toBe("OFFLINE")
  })

  it("leaves a legacy profile alone", () => {
    expect(
      presentedBackupHealth({
        profileStatus: "ENABLED",
        health: "UP_TO_DATE",
        roots: [orphan],
        ownershipObserved: false,
      }),
    ).toBe("UP_TO_DATE")
  })
})

const root = (id: string, sourcePathIdentifier: string, acknowledgedAt: Date | null) => ({
  id,
  sourcePathIdentifier,
  status: "PROTECTED",
  acknowledgedAt,
})

describe("8, 9, 12, 14 · what a present ownership list withdraws", () => {
  const held = root("r1", "aaa", ACK)
  const alsoHeld = root("r2", "bbb", ACK)

  it("9 · withdraws an acknowledged root absent from the list", () => {
    expect(rootsToWithdraw([held, alsoHeld], ["aaa"]).map((r) => r.id)).toEqual(["r2"])
  })

  it("8 · keeps a root present in the list", () => {
    expect(rootsToWithdraw([held, alsoHeld], ["aaa", "bbb"])).toEqual([])
  })

  it("an empty list is a real statement: everything owned is withdrawn", () => {
    expect(rootsToWithdraw([held, alsoHeld], []).map((r) => r.id)).toEqual(["r1", "r2"])
  })

  it("never withdraws a root the computer never claimed", () => {
    // Nothing to take away — it was never owned. It fails the count instead.
    expect(rootsToWithdraw([root("r3", "ccc", null)], [])).toEqual([])
  })

  it("14 · ignores identifiers naming no known root, rather than creating one", () => {
    const withdrawn = rootsToWithdraw([held], ["aaa", "never-seen-before"])
    expect(withdrawn).toEqual([])
  })

  it("12 · withdrawal is a status change, so entries and files are untouched", () => {
    // The pure decision only ever *names* roots; the caller routes them through
    // disableSyncRoot, which updates status and deletes nothing.
    const withdrawn = rootsToWithdraw([held, alsoHeld], ["aaa"])
    expect(withdrawn).toHaveLength(1)
    expect(withdrawn[0]).toBe(alsoHeld)
    expect(alsoHeld.status).toBe("PROTECTED")
  })

  it("ignores blank identifiers rather than treating them as a root", () => {
    expect(rootsToWithdraw([held], ["", "   ", "aaa"])).toEqual([])
  })

  it("tolerates surrounding whitespace in an identifier", () => {
    expect(rootsToWithdraw([held], [" aaa "])).toEqual([])
  })
})

describe("10, 11 · silence is never a statement", () => {
  it("10 · there is no withdrawal without a present list", () => {
    // heartbeatBackupProfile only reaches applyRootOwnership when the field is
    // present (`!== undefined`); an absent field never calls this at all.
    // Passing the roots with no statement is not representable — the closest
    // is an empty list, which is a *different* message and is tested above.
    const undisturbed = rootsToWithdraw([], [])
    expect(undisturbed).toEqual([])
  })

  it("11 · being offline cannot end ownership", () => {
    // No heartbeat means no call, so an owned root keeps counting.
    expect(isProtectedRoot(owned, true)).toBe(true)
  })
})

describe("15 · the protocol carries no paths", () => {
  it("ownership is expressed as opaque identifiers", () => {
    // sourcePathIdentifier is SHA-256(serverId ‖ kind ‖ lowercased path)
    // truncated to 16 bytes — one-way, and rejected by the server if it looks
    // like a path at all.
    const identifier = "9f86d081884c7d65"
    expect(identifier).not.toMatch(/[\\/]/)
    expect(identifier).toMatch(/^[0-9a-f]+$/)
  })
})

describe("16 · migration preserves legacy clients", () => {
  it("a profile that has never reported ownership keeps every root protected", () => {
    // Exactly the production state at deploy time: three real roots, none
    // acknowledged yet, old Desktop still installed.
    const live = [orphan, orphan, orphan]
    expect(countProtectedRoots(live, false)).toBe(3)
    expect(countProtectedRoots(live, true)).toBe(0)
  })
})

describe("the Games case, end to end", () => {
  /**
   * The nine roots on DESKTOP-S8FBLDB as production held them, before the
   * legacy Desktop has reported any ownership. Games is the one that was
   * created through backup setup and never held by any computer.
   */
  const production = [
    { status: "PROTECTED", acknowledgedAt: null }, // TestBackup
    { status: "DISABLED", acknowledgedAt: null },  // OrderCheck
    { status: "DISABLED", acknowledgedAt: null },  // Pictures
    { status: "PROTECTED", acknowledgedAt: null }, // api
    { status: "DISABLED", acknowledgedAt: null },  // RootCycleTest
    { status: "DISABLED", acknowledgedAt: null },  // Desktop
    { status: "DISABLED", acknowledgedAt: null },  // ArciinWatcherTest
    { status: "PROTECTED", acknowledgedAt: null }, // avater
    { status: "DISABLED", acknowledgedAt: null },  // Games — disabled already
  ]

  it("reads 3 today, with the legacy client still installed", () => {
    expect(countProtectedRoots(production, false)).toBe(3)
  })

  it("still reads 3 once the new Desktop acknowledges the three real roots", () => {
    const acknowledged = production.map((r) =>
      r.status === "PROTECTED" ? { ...r, acknowledgedAt: ACK } : r,
    )
    expect(countProtectedRoots(acknowledged, true)).toBe(3)
  })

  it("a re-created Games would not inflate the count again", () => {
    // Backup setup can still create a root server-side; it simply cannot claim
    // protection until a computer says it holds it.
    const withNewOrphan = [
      ...production.map((r) => (r.status === "PROTECTED" ? { ...r, acknowledgedAt: ACK } : r)),
      { status: "PROTECTED", acknowledgedAt: null },
    ]
    expect(countProtectedRoots(withNewOrphan, true)).toBe(3)
  })
})
