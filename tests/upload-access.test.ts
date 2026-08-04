import { describe, expect, it } from "vitest"

import {
  UPLOAD_READ_SCOPES,
  canMutateUploadSession,
  canReadUploadSession,
  resolveUploadAccess,
  uploadListWhere,
  type UploadPrincipal,
} from "../apps/api/src/services/uploads/upload-access"

/**
 * UP-010 — upload listing authorization.
 *
 * `GET /uploads` ran an unscoped findMany, so any authenticated principal —
 * VIEWER included, and any API key holding only `uploads:create` — could
 * enumerate every user's recent uploads with original filenames.
 */

const session = (role: UploadPrincipal["role"], userId = "user-1"): UploadPrincipal => ({
  userId,
  role,
  apiKeyScopes: null,
})

const apiKey = (
  role: UploadPrincipal["role"],
  scopes: string[],
  userId = "user-1",
): UploadPrincipal => ({ userId, role, apiKeyScopes: scopes })

describe("resolveUploadAccess — sessions", () => {
  it("gives OWNER and ADMIN the whole instance", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const decision = resolveUploadAccess(session(role))
      expect(decision.allowed).toBe(true)
      if (decision.allowed) {
        expect(decision.scope).toBe("instance")
        expect(decision.where).toEqual({})
      }
    }
  })

  it("restricts MEMBER to their own uploads", () => {
    const decision = resolveUploadAccess(session("MEMBER", "member-9"))
    expect(decision.allowed).toBe(true)
    if (decision.allowed) {
      expect(decision.scope).toBe("own")
      expect(decision.where).toEqual({ userId: "member-9" })
    }
  })

  it("restricts VIEWER to their own uploads", () => {
    // VIEWER is read-only but not blind: it keeps its own history and never
    // sees another user's rows.
    const decision = resolveUploadAccess(session("VIEWER", "viewer-3"))
    expect(decision.allowed).toBe(true)
    if (decision.allowed) {
      expect(decision.scope).toBe("own")
      expect(decision.where).toEqual({ userId: "viewer-3" })
    }
  })
})

describe("resolveUploadAccess — API keys", () => {
  it("refuses a key holding only uploads:create", () => {
    // Permission to upload is not permission to read everyone's history.
    const decision = resolveUploadAccess(apiKey("OWNER", ["uploads:create"]))
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) expect(decision.reason).toBe("missing_scope")
  })

  it("refuses a key with no scopes at all", () => {
    expect(resolveUploadAccess(apiKey("OWNER", [])).allowed).toBe(false)
  })

  it("accepts a key holding a genuine read scope", () => {
    for (const scope of UPLOAD_READ_SCOPES) {
      expect(resolveUploadAccess(apiKey("OWNER", [scope])).allowed).toBe(true)
    }
  })

  it("never lets a key exceed its owner's role", () => {
    // A MEMBER's key with assets:read still only reads that member's uploads.
    const decision = resolveUploadAccess(apiKey("MEMBER", ["assets:read"], "member-2"))
    expect(decision.allowed).toBe(true)
    if (decision.allowed) {
      expect(decision.scope).toBe("own")
      expect(decision.where).toEqual({ userId: "member-2" })
    }
  })

  it("gives an OWNER key with a read scope instance-wide access", () => {
    const decision = resolveUploadAccess(apiKey("OWNER", ["assets:read"]))
    expect(decision.allowed && decision.scope).toBe("instance")
  })
})

describe("uploadListWhere", () => {
  it("returns null when the principal may not read", () => {
    expect(uploadListWhere(apiKey("OWNER", ["uploads:create"]))).toBeNull()
  })

  it("is unfiltered for instance-wide principals", () => {
    expect(uploadListWhere(session("OWNER"))).toEqual({})
  })

  it("always constrains a non-admin to their own rows", () => {
    expect(uploadListWhere(session("MEMBER", "m1"))).toEqual({ userId: "m1" })
  })

  it("ANDs caller filters so they cannot widen the authorized set", () => {
    // A caller-supplied userId must not override ownership.
    const where = uploadListWhere(session("MEMBER", "m1"), { userId: "someone-else" })
    expect(where).toEqual({ AND: [{ userId: "m1" }, { userId: "someone-else" }] })
    // AND of two different userIds matches nothing — it cannot leak.
  })

  it("ANDs caller filters for admins too", () => {
    expect(uploadListWhere(session("OWNER"), { status: "READY" })).toEqual({
      AND: [{}, { status: "READY" }],
    })
  })
})

describe("canReadUploadSession", () => {
  it("lets OWNER and ADMIN read anyone's session", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      expect(canReadUploadSession(session(role, "admin-1"), { userId: "other" })).toBe(true)
    }
  })

  it("lets a MEMBER read their own session", () => {
    expect(canReadUploadSession(session("MEMBER", "m1"), { userId: "m1" })).toBe(true)
  })

  it("stops a MEMBER reading another user's session", () => {
    expect(canReadUploadSession(session("MEMBER", "m1"), { userId: "m2" })).toBe(false)
  })

  it("stops a VIEWER reading another user's session", () => {
    expect(canReadUploadSession(session("VIEWER", "v1"), { userId: "m2" })).toBe(false)
  })

  it("stops a key without a read scope reading even its own session", () => {
    expect(
      canReadUploadSession(apiKey("OWNER", ["uploads:create"], "u1"), { userId: "u1" }),
    ).toBe(false)
  })
})

describe("canMutateUploadSession", () => {
  it("allows the uploader", () => {
    expect(canMutateUploadSession(session("MEMBER", "m1"), { userId: "m1" })).toBe(true)
  })

  it("allows OWNER and ADMIN on anyone's session", () => {
    expect(canMutateUploadSession(session("ADMIN", "a1"), { userId: "m1" })).toBe(true)
  })

  it("blocks a MEMBER on someone else's session", () => {
    expect(canMutateUploadSession(session("MEMBER", "m1"), { userId: "m2" })).toBe(false)
  })

  it("blocks a VIEWER on someone else's session", () => {
    expect(canMutateUploadSession(session("VIEWER", "v1"), { userId: "m1" })).toBe(false)
  })
})
