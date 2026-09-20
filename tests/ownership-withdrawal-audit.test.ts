import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  OWNERSHIP_WITHDRAWAL_REASON,
  ownershipAuditRecord,
  rootsToWithdraw,
  withdrawalAuditRecord,
} from "../apps/api/src/services/backup/serialize"

/**
 * Withdrawal has to leave a trace.
 *
 * Three real roots — TestBackup, api and avater — were withdrawn by an
 * ownership heartbeat, and afterwards there was no way to establish what that
 * heartbeat had actually said. The mechanism was provable by elimination; the
 * payload was gone. These records are what make the same question answerable
 * next time, so they are asserted rather than left to a reviewer's eye.
 */

const ACK = new Date("2026-09-15T21:48:27.192Z")
const root = (id: string, displayName: string, sourcePathIdentifier: string) => ({
  id,
  displayName,
  sourcePathIdentifier,
  status: "PROTECTED",
  acknowledgedAt: ACK,
})

/** The three roots as production held them. */
const testBackup = root("cmu183caz03b6tovtvp52qnpm", "TestBackup", "6a3933c0b5051479aebaa77b9babf740")
const api = root("cmu1lrhmv04u9to2nqf0sizp6", "api", "20c451c201cc7c9d54a2e19d4043741b")
const avater = root("cmu20xcnf00mutohbkkk7b6p9", "avater", "e70ac2633033b2ad7d0dcb46bdc40036")
const activeRoots = [testBackup, api, avater]

const PROFILE = "cmu183cam03b2tovty4a8diyu"
const DEVICE = "cmu0n11fc000dtobwex5teqfg"

describe("the statement that caused a withdrawal is recorded", () => {
  // The incident payload: a present list that omitted all three.
  const withdrawing = rootsToWithdraw(activeRoots, [])
  const record = ownershipAuditRecord({
    profileId: PROFILE,
    deviceId: DEVICE,
    receivedIdentifiers: [],
    activeRoots,
    withdrawing,
  })

  it("names the profile, the device and when", () => {
    expect(record.profileId).toBe(PROFILE)
    expect(record.deviceId).toBe(DEVICE)
    expect(Date.parse(record.at)).not.toBeNaN()
  })

  it("records what arrived, including that it was empty", () => {
    expect(record.receivedCount).toBe(0)
    expect(record.received).toEqual([])
  })

  it("records what was acknowledged at the time, so the omission is visible", () => {
    expect(record.acknowledgedActive).toEqual([
      testBackup.sourcePathIdentifier,
      api.sourcePathIdentifier,
      avater.sourcePathIdentifier,
    ])
  })

  it("names every root the statement removes", () => {
    expect(record.withdrawing.map((r) => r.displayName)).toEqual(["TestBackup", "api", "avater"])
    expect(record.withdrawing[0]).toEqual({
      rootId: testBackup.id,
      displayName: "TestBackup",
      sourcePathIdentifier: testBackup.sourcePathIdentifier,
    })
  })

  it("records a statement that removes nothing just the same", () => {
    // The quiet case is the one that proves a heartbeat was *not* the culprit.
    const keep = ownershipAuditRecord({
      profileId: PROFILE,
      deviceId: DEVICE,
      receivedIdentifiers: activeRoots.map((r) => r.sourcePathIdentifier),
      activeRoots,
      withdrawing: rootsToWithdraw(activeRoots, activeRoots.map((r) => r.sourcePathIdentifier)),
    })
    expect(keep.receivedCount).toBe(3)
    expect(keep.withdrawing).toEqual([])
  })
})

describe("each withdrawn root is recorded on its own", () => {
  const record = withdrawalAuditRecord({ profileId: PROFILE, deviceId: DEVICE, root: avater })

  it("carries a greppable reason", () => {
    expect(record.reason).toBe("OWNERSHIP_HEARTBEAT_WITHDRAWAL")
    expect(OWNERSHIP_WITHDRAWAL_REASON).toBe("OWNERSHIP_HEARTBEAT_WITHDRAWAL")
  })

  it("identifies the root, the profile and the device", () => {
    expect(record).toMatchObject({
      rootId: avater.id,
      displayName: "avater",
      sourcePathIdentifier: avater.sourcePathIdentifier,
      profileId: PROFILE,
      deviceId: DEVICE,
    })
  })
})

describe("nothing sensitive reaches the log", () => {
  const serialised = JSON.stringify([
    ownershipAuditRecord({
      profileId: PROFILE,
      deviceId: DEVICE,
      receivedIdentifiers: [avater.sourcePathIdentifier],
      activeRoots,
      withdrawing: rootsToWithdraw(activeRoots, [avater.sourcePathIdentifier]),
    }),
    withdrawalAuditRecord({ profileId: PROFILE, deviceId: DEVICE, root: api }),
  ])

  it("carries no credential or token field", () => {
    expect(serialised).not.toMatch(/credential|token|secret|password|grant/i)
  })

  it("carries no local path", () => {
    // sourcePathIdentifier is a one-way hash; a real path would show a
    // separator or a drive letter.
    expect(serialised).not.toMatch(/[A-Za-z]:\\\\/)
    expect(serialised).not.toMatch(/\\\\\\\\/)
    expect(serialised).not.toMatch(/\/Users\/|\/home\/|C:/)
  })

  it("only ever emits opaque 32-character identifiers", () => {
    const record = ownershipAuditRecord({
      profileId: PROFILE,
      deviceId: DEVICE,
      receivedIdentifiers: [avater.sourcePathIdentifier],
      activeRoots,
      withdrawing: [],
    })
    for (const id of [...record.received, ...record.acknowledgedActive]) {
      expect(id).toMatch(/^[0-9a-f]{32}$/)
    }
  })
})

describe("the records are actually emitted from the withdrawal path", () => {
  // profile.ts cannot be imported here — it reaches the rest of the API through
  // the "@/" alias, which vitest maps to apps/web (see vitest.config.ts). The
  // wiring is asserted from source instead, which is how this repo pins its
  // other procedural invariants.
  const source = readFileSync(
    path.join(__dirname, "..", "apps", "api", "src", "services", "backup", "profile.ts"),
    "utf8",
  )
  const applyFn = source.slice(
    source.indexOf("export async function applyRootOwnership"),
    source.indexOf("export async function heartbeatBackupProfile"),
  )

  it("logs the ownership statement it received", () => {
    expect(applyFn).toContain("ownershipAuditRecord({")
    expect(applyFn).toMatch(/log\?\.info\(/)
  })

  it("logs the statement before performing any write", () => {
    const logAt = applyFn.indexOf("ownershipAuditRecord({")
    const writeAt = applyFn.indexOf("await disableSyncRoot(")
    expect(logAt).toBeGreaterThan(-1)
    expect(writeAt).toBeGreaterThan(-1)
    // A statement that is only recorded after the writes is lost if a write throws.
    expect(logAt).toBeLessThan(writeAt)
  })

  it("logs every individual root it withdraws", () => {
    const withdrawLoop = applyFn.slice(applyFn.indexOf("for (const root of withdrawing)"))
    expect(withdrawLoop).toContain("await disableSyncRoot(prisma, root.id)")
    expect(withdrawLoop).toContain("withdrawalAuditRecord({")
  })

  it("is handed the request logger by the heartbeat route", () => {
    const routes = readFileSync(
      path.join(__dirname, "..", "apps", "api", "src", "modules", "backup", "routes.ts"),
      "utf8",
    )
    const call = routes.slice(routes.indexOf("heartbeatBackupProfile("))
    expect(call.slice(0, 200)).toContain("request.log")
  })
})
