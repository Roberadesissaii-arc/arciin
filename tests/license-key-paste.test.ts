import { describe, expect, it } from "vitest"

import { describeNonKeyInput, resolveMockPlanFromKey } from "@arciin/config"

/**
 * What people actually paste into Settings → License.
 *
 * A real customer bought a license, saw `ARC_PRO_8544…FEEA` on screen, pasted
 * that, and got "Unrecognized license key" — which is true and useless. The
 * ellipsis is a mask, and the whole key was sitting in their email. The other
 * frequent miss is the promo code that produced the license.
 *
 * These two answers have to be specific, and they must not swallow a key that
 * is merely unknown to this instance — that judgement belongs to the authority.
 */

describe("obvious non-keys are named for what they are", () => {
  it("catches the masked value the portal shows", () => {
    const message = describeNonKeyInput("ARC_PRO_8544…FEEA")
    expect(message).toBeTruthy()
    expect(message).toMatch(/shortened/i)
    expect(message).toMatch(/email/i)
  })

  it("catches an ASCII three-dot mask too", () => {
    expect(describeNonKeyInput("ARC_PRO_8544...FEEA")).toMatch(/shortened/i)
  })

  it("catches a promo code pasted as a key", () => {
    const message = describeNonKeyInput("ARCIIN-27A187EF3E5F")
    expect(message).toBeTruthy()
    expect(message).toMatch(/promo code/i)
    expect(message).toMatch(/checkout/i)
    // Says where the real key comes from, rather than only what is wrong.
    expect(message).toMatch(/ARC_/)
  })

  it("asks for something when the box is empty", () => {
    expect(describeNonKeyInput("   ")).toBeTruthy()
  })
})

describe("it never intercepts a plausible key", () => {
  it("lets a real hosted key through to the authority", () => {
    expect(describeNonKeyInput("ARC_PRO_8544ABCDEF0123456789FEEA")).toBeNull()
  })

  it("lets an unknown-but-well-formed key through", () => {
    // Whether a key exists is the authority's call, not a regex's.
    expect(describeNonKeyInput("ARC_TEAM_0000000000000000")).toBeNull()
  })

  it("does not eat dev mock keys, which also start with ARCIIN-", () => {
    expect(describeNonKeyInput("ARCIIN-DEV-PRO")).toBeNull()
    expect(resolveMockPlanFromKey("ARCIIN-DEV-PRO")).toBe("pro")
  })

  it("tolerates surrounding whitespace from a copy-paste", () => {
    expect(describeNonKeyInput("  ARC_PRO_8544ABCDEF0123456789FEEA \n")).toBeNull()
  })
})
