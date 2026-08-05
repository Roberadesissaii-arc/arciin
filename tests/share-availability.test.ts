import { describe, expect, it } from "vitest"

import { checkShareAvailability } from "@arciin/shared"

/**
 * Share links must stop serving when their root is deleted.
 *
 * `resolveShareByToken` checked revoked / expired / view-limit but never
 * whether the shared folder or asset had since been deleted, so deleting a
 * folder did not revoke its public link — it kept listing and serving the
 * folder's surviving files. One such share was live in production.
 */

const NOW = Date.parse("2026-08-04T12:00:00Z")
const HOUR = 60 * 60 * 1000

const live = {
  exists: true,
  revokedAt: null,
  expiresAt: new Date(NOW + HOUR),
  maxViews: null,
  viewCount: 0,
  now: NOW,
}

describe("checkShareAvailability — existing rules still hold", () => {
  it("serves a live share", () => {
    expect(
      checkShareAvailability({ ...live, resourceType: "FOLDER", target: { deletedAt: null } }),
    ).toEqual({ available: true })
  })

  it("refuses a missing share", () => {
    expect(checkShareAvailability({ ...live, exists: false })).toEqual({
      available: false,
      code: "NOT_FOUND",
    })
  })

  it("refuses a revoked share", () => {
    expect(checkShareAvailability({ ...live, revokedAt: new Date(NOW - HOUR) }).available).toBe(
      false,
    )
    expect(
      checkShareAvailability({ ...live, revokedAt: new Date(NOW - HOUR) }),
    ).toMatchObject({ code: "REVOKED" })
  })

  it("refuses an expired share, including one expiring exactly now", () => {
    expect(
      checkShareAvailability({ ...live, expiresAt: new Date(NOW - 1) }),
    ).toMatchObject({ code: "EXPIRED" })
    expect(checkShareAvailability({ ...live, expiresAt: new Date(NOW) })).toMatchObject({
      code: "EXPIRED",
    })
  })

  it("refuses a share past its view limit", () => {
    expect(
      checkShareAvailability({ ...live, maxViews: 5, viewCount: 5 }),
    ).toMatchObject({ code: "VIEW_LIMIT" })
  })

  it("never expires a share with no expiry", () => {
    expect(
      checkShareAvailability({
        ...live,
        expiresAt: null,
        resourceType: "FOLDER",
        target: { deletedAt: null },
      }),
    ).toEqual({ available: true })
  })
})

describe("checkShareAvailability — deleted roots (the fix)", () => {
  it("stops serving a FOLDER share once the folder is deleted", () => {
    const result = checkShareAvailability({
      ...live,
      resourceType: "FOLDER",
      target: { deletedAt: new Date(NOW - HOUR) },
    })
    expect(result).toEqual({ available: false, code: "NOT_FOUND" })
  })

  it("stops serving an ASSET share once the asset is trashed", () => {
    expect(
      checkShareAvailability({
        ...live,
        resourceType: "ASSET",
        target: { deletedAt: new Date(NOW - HOUR) },
      }),
    ).toMatchObject({ code: "NOT_FOUND" })
  })

  it("also honours a DELETED status without a deletedAt timestamp", () => {
    expect(
      checkShareAvailability({
        ...live,
        resourceType: "ASSET",
        target: { deletedAt: null, status: "DELETED" },
      }),
    ).toMatchObject({ code: "NOT_FOUND" })
  })

  it("reports a deleted root as NOT_FOUND, never a distinct code", () => {
    // A distinct "deleted" code would tell a recipient that content once
    // existed here. Indistinguishable from "never existed" is the point.
    const deleted = checkShareAvailability({
      ...live,
      resourceType: "FOLDER",
      target: { deletedAt: new Date(NOW - HOUR) },
    })
    const missing = checkShareAvailability({ ...live, exists: false })
    expect(deleted).toEqual(missing)
  })

  it("refuses a FOLDER share whose folder row has vanished", () => {
    expect(
      checkShareAvailability({ ...live, resourceType: "FOLDER", target: null }),
    ).toMatchObject({ code: "NOT_FOUND" })
  })

  it("still serves a FOLDER share whose folder is alive", () => {
    expect(
      checkShareAvailability({
        ...live,
        resourceType: "FOLDER",
        target: { deletedAt: null, status: "READY" },
      }),
    ).toEqual({ available: true })
  })

  it("leaves ASSETS shares to their per-member filtering", () => {
    // A multi-asset share has no single root; members are filtered downstream,
    // so a null target here must not kill the whole share.
    expect(
      checkShareAvailability({ ...live, resourceType: "ASSETS", target: null }),
    ).toEqual({ available: true })
  })

  it("checks revocation before deletion so an explicit revoke is reported as such", () => {
    expect(
      checkShareAvailability({
        ...live,
        revokedAt: new Date(NOW - HOUR),
        resourceType: "FOLDER",
        target: { deletedAt: new Date(NOW - HOUR) },
      }),
    ).toMatchObject({ code: "REVOKED" })
  })
})
