import { describe, expect, it } from "vitest"

import {
  countProtectedRoots,
  presentedBackupHealth,
} from "../apps/api/src/services/backup/serialize"

describe("backup protected-root accounting", () => {
  it("counts only non-disabled roots", () => {
    expect(
      countProtectedRoots([
        { status: "PROTECTED" },
        { status: "SYNCING" },
        { status: "DISABLED" },
        { status: "PAUSED" },
      ]),
    ).toBe(3)
  })

  it("does not present Up to date when nothing is protected", () => {
    expect(
      presentedBackupHealth({
        profileStatus: "ENABLED",
        health: "UP_TO_DATE",
        roots: [{ status: "DISABLED" }],
      }),
    ).toBe("OFFLINE")
    expect(
      presentedBackupHealth({
        profileStatus: "DISABLED",
        health: "UP_TO_DATE",
        roots: [{ status: "PROTECTED" }],
      }),
    ).toBe("DISABLED")
    expect(
      presentedBackupHealth({
        profileStatus: "ENABLED",
        health: "UP_TO_DATE",
        roots: [{ status: "PROTECTED" }],
      }),
    ).toBe("UP_TO_DATE")
  })
})
