import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  canEnablePublicRemoteAccess,
  readOwnerMfaState,
} from "../apps/api/src/services/security/owner-mfa-policy"

/**
 * When the owner's second factor is required rather than recommended.
 *
 * The policy is asymmetric on purpose. An instance that already exists must
 * not have its owner locked out by an upgrade — they are prompted, but they
 * can still sign in and still use the server on their own network. Putting it
 * on the public internet is the moment a password stops being the only thing
 * between a stranger and the library, and that is where enrolment becomes a
 * requirement.
 */

const prismaWith = (owner: { mfaEnabledAt: Date | null } | null) =>
  ({ user: { findFirst: async () => owner } }) as never

describe("an upgraded owner is prompted, not locked out", () => {
  it("reports an owner who has not enrolled", async () => {
    const state = await readOwnerMfaState(prismaWith({ mfaEnabledAt: null }))
    expect(state).toMatchObject({ ownerExists: true, ownerHasMfa: false })
  })

  it("does not enforce sign-in MFA before enrolment", async () => {
    // The upgrade path. Enforcing here would lock an existing owner out of
    // their own instance the moment they updated.
    const state = await readOwnerMfaState(prismaWith({ mfaEnabledAt: null }))
    expect(state.enforcedForOwner).toBe(false)
  })

  it("enforces it once they have enrolled", async () => {
    const state = await readOwnerMfaState(prismaWith({ mfaEnabledAt: new Date() }))
    expect(state.enforcedForOwner).toBe(true)
  })

  it("ties enforcement to enrolment rather than a separate switch", async () => {
    // Two flags could disagree, and one of the states that produces is "set up
    // but ignored".
    for (const enrolled of [null, new Date()]) {
      const state = await readOwnerMfaState(prismaWith({ mfaEnabledAt: enrolled }))
      expect(state.enforcedForOwner).toBe(state.ownerHasMfa)
    }
  })
})

describe("the public door is where it becomes a requirement", () => {
  it("refuses public Remote Access while the owner has no second factor", async () => {
    const verdict = await canEnablePublicRemoteAccess(prismaWith({ mfaEnabledAt: null }))
    expect(verdict.allowed).toBe(false)
    if (verdict.allowed) return
    expect(verdict.code).toBe("OWNER_MFA_REQUIRED")
    // The message has to say what to do and reassure that nothing broke.
    expect(verdict.message).toMatch(/two-factor/i)
    expect(verdict.message).toMatch(/own network/i)
  })

  it("allows it once the owner has enrolled", async () => {
    expect(
      (await canEnablePublicRemoteAccess(prismaWith({ mfaEnabledAt: new Date() }))).allowed,
    ).toBe(true)
  })

  it("does not block a server with no owner yet", async () => {
    // Before the instance is claimed there is nobody to enrol; refusing here
    // would be a setup dead end rather than a protection.
    expect((await canEnablePublicRemoteAccess(prismaWith(null))).allowed).toBe(true)
  })

  it("leaves LAN use alone", async () => {
    // The check lives on the tunnel-start route, not on sign-in. If it ever
    // moves, an upgraded owner loses access to their own server at home.
    const settings = readFileSync("apps/api/src/modules/settings/routes.ts", "utf8")
    const auth = readFileSync("apps/api/src/modules/auth/routes.ts", "utf8")
    expect(settings).toContain("canEnablePublicRemoteAccess")
    expect(auth).not.toContain("canEnablePublicRemoteAccess")
  })

  it("offers no flag that switches enforcement off for good", () => {
    const source = readFileSync(
      "apps/api/src/services/security/owner-mfa-policy.ts",
      "utf8",
    )
    // A bypass flag is the first thing worth attacking.
    expect(source).not.toMatch(/skipMfa|disableMfaPolicy|mfaBypass|allowInsecure/i)
  })
})

describe("the panel tells the truth about what it holds", () => {
  const panel = readFileSync("apps/web/components/settings/mfa-panel.tsx", "utf8")

  it("shows the secret and QR only while enrolling", () => {
    // Both live on the "scan" stage, which exists only before MFA is on.
    const enabledBranch = panel.slice(panel.indexOf('stage.name === "idle" && enabled'))
    expect(enabledBranch.slice(0, 600)).not.toContain("qrDataUrl")
    expect(enabledBranch.slice(0, 600)).not.toContain("stage.secret")
  })

  it("offers the recovery codes as a download rather than taking one", () => {
    // A credentials file appearing in Downloads unasked is a surprise.
    expect(panel).toContain("arciin-recovery-codes.txt")
    expect(panel).toContain("Download")
  })

  it("will not finish setup until the codes are acknowledged", () => {
    expect(panel).toContain("I have saved these somewhere safe")
    expect(panel).toContain("disabled={!acknowledged}")
  })

  it("treats turning it off as destructive", () => {
    const off = panel.slice(panel.indexOf("Turn off") - 300, panel.indexOf("Turn off"))
    expect(off).toContain('variant="destructive"')
  })

  it("names authenticator apps without requiring an account with any of them", () => {
    expect(panel).toMatch(/Google Authenticator/)
    expect(panel).toMatch(/offline/i)
  })

  it("never writes anything to browser storage", () => {
    expect(panel).not.toMatch(/localStorage|sessionStorage/)
  })
})
