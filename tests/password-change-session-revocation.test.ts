import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

/**
 * L-5: changing a password left every other session signed in.
 *
 * The usual reason to change a password is that somebody thinks it is known,
 * so leaving the other sessions alive defeated the change for exactly the case
 * it exists to answer.
 *
 * These assert the contract at the source, because the behaviour is a database
 * delete inside a route and the two properties worth pinning are which rows go
 * and which stay.
 */

const routes = readFileSync("apps/api/src/modules/auth/routes.ts", "utf8")

describe("changing a password signs out the other sessions", () => {
  it("offers the choice, and defaults to doing it", () => {
    expect(routes).toContain("signOutOtherSessions")
    // `!== false` rather than `=== true`: a client that omits the field gets
    // the safe behaviour rather than the convenient one.
    expect(routes).toContain("parsed.data.signOutOtherSessions !== false")
  })

  it("scopes the delete to this user", () => {
    // An earlier instance-wide revoke exists for administrators. This one must
    // not become that by accident.
    const block = routes.slice(routes.indexOf("const signOutOthers"))
    expect(block.slice(0, 900)).toContain("userId: user.id")
  })

  it("keeps the session doing the changing", () => {
    const block = routes.slice(routes.indexOf("const signOutOthers"), routes.indexOf("const signOutOthers") + 900)
    expect(block).toContain("tokenHash: { not: currentHash }")
  })

  it("does not touch device pairings", () => {
    // Session rows go; Device rows do not. A paired Desktop loses its session
    // and gets a new one from its own credential, rather than needing to be
    // paired again from the other machine.
    const block = routes.slice(routes.indexOf("const signOutOthers"), routes.indexOf("const signOutOthers") + 900)
    expect(block).not.toContain("device.deleteMany")
    expect(block).not.toContain("devicePairing.deleteMany")
  })

  it("says how many it signed out", () => {
    expect(routes).toContain("otherSessionsRevoked")
  })
})

describe("the same action stands alone for Account → Sessions", () => {
  it("exists as one call rather than one per session", () => {
    // The page used to loop and revoke individually, which can half-finish and
    // leave some of the very sessions it is meant to end still signed in.
    expect(routes).toContain('"/auth/sessions/revoke-others"')
  })

  it("is scoped and preserves the current session too", () => {
    const block = routes.slice(routes.indexOf('"/auth/sessions/revoke-others"'))
    expect(block.slice(0, 800)).toContain("userId: user.id")
    expect(block.slice(0, 800)).toContain("tokenHash: { not: currentHash }")
  })

  it("records a security event", () => {
    const block = routes.slice(routes.indexOf('"/auth/sessions/revoke-others"'))
    expect(block.slice(0, 900)).toContain("auth.sessions_revoked")
  })
})
