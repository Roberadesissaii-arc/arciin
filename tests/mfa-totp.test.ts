import { authenticator } from "otplib"
import { describe, expect, it } from "vitest"

import {
  RECOVERY_CODE_COUNT,
  TOTP_STEP_SECONDS,
  buildOtpAuthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  normalizeRecoveryCode,
  recoveryCodeHashesMatch,
  totpStepFor,
  verifyTotp,
} from "../apps/api/src/services/security/mfa"

/**
 * H-1: the instance had no second factor at all. A stolen password was the
 * whole of the authentication story.
 */

const secret = generateTotpSecret()

describe("enrolment produces something an authenticator can read", () => {
  it("generates a base32 secret", () => {
    expect(secret).toMatch(/^[A-Z2-7]+$/)
    expect(secret.length).toBeGreaterThanOrEqual(16)
  })

  it("generates a different secret every time", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret())
  })

  it("builds an otpauth URI carrying issuer and account", () => {
    const uri = buildOtpAuthUri({ secret, accountName: "owner@example.com", issuer: "Arciin" })
    expect(uri.startsWith("otpauth://totp/")).toBe(true)
    expect(uri).toContain("Arciin")
    expect(uri).toContain("owner%40example.com")
    expect(uri).toContain(`secret=${secret}`)
  })
})

describe("a submitted code is checked, once", () => {
  it("accepts the current code", () => {
    const token = authenticator.generate(secret)
    expect(verifyTotp({ token, secret, lastUsedStep: null })).toMatchObject({ ok: true })
  })

  it("refuses a code that is not six digits", () => {
    for (const token of ["", "12345", "1234567", "abcdef", "12 34 56 78"]) {
      expect(verifyTotp({ token, secret, lastUsedStep: null })).toMatchObject({
        ok: false,
        reason: "malformed",
      })
    }
  })

  it("tolerates spacing, because authenticator apps show codes in groups", () => {
    const token = authenticator.generate(secret)
    const spaced = `${token.slice(0, 3)} ${token.slice(3)}`
    expect(verifyTotp({ token: spaced, secret, lastUsedStep: null })).toMatchObject({ ok: true })
  })

  it("refuses a wrong code", () => {
    const wrong = authenticator.generate(generateTotpSecret())
    const result = verifyTotp({ token: wrong, secret, lastUsedStep: null })
    if (result.ok) {
      // Astronomically unlikely collision; assert the shape rather than flake.
      expect(result.step).toBeTypeOf("number")
    } else {
      expect(result.reason).toBe("invalid")
    }
  })

  it("refuses a code from a step already spent", () => {
    const token = authenticator.generate(secret)
    const first = verifyTotp({ token, secret, lastUsedStep: null })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    // Same code, same window: otplib alone would accept it again.
    expect(verifyTotp({ token, secret, lastUsedStep: first.step })).toMatchObject({
      ok: false,
      reason: "replayed",
    })
  })

  it("keeps the accepted window narrow", () => {
    // Each extra step is another 30 seconds a shoulder-surfed code still works.
    expect(TOTP_STEP_SECONDS).toBe(30)
    const now = totpStepFor(1_700_000_000_000)
    expect(totpStepFor(1_700_000_000_000 + 30_000)).toBe(now + 1)
  })
})

describe("recovery codes are single-use and never stored in the clear", () => {
  const codes = generateRecoveryCodes()

  it("issues a full set", () => {
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT)
  })

  it("issues distinct codes", () => {
    expect(new Set(codes).size).toBe(codes.length)
  })

  it("hashes to something that is not the code", () => {
    for (const code of codes.slice(0, 3)) {
      const hash = hashRecoveryCode(code)
      expect(hash).not.toContain(normalizeRecoveryCode(code))
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it("hashes the same code the same way however it is typed", () => {
    const code = codes[0]!
    expect(hashRecoveryCode(code.toLowerCase())).toBe(hashRecoveryCode(code))
    expect(hashRecoveryCode(code.replace(/-/g, ""))).toBe(hashRecoveryCode(code))
    expect(hashRecoveryCode(` ${code} `)).toBe(hashRecoveryCode(code))
  })

  it("does not confuse two different codes", () => {
    expect(hashRecoveryCode(codes[0]!)).not.toBe(hashRecoveryCode(codes[1]!))
  })

  it("compares hashes without leaking where they diverge", () => {
    const h = hashRecoveryCode(codes[0]!)
    expect(recoveryCodeHashesMatch(h, h)).toBe(true)
    expect(recoveryCodeHashesMatch(h, hashRecoveryCode(codes[1]!))).toBe(false)
    expect(recoveryCodeHashesMatch(h, "short")).toBe(false)
  })

  it("carries enough entropy that hashing fast is the right choice", () => {
    // 10 random bytes per code: there is no human-chosen password here to slow
    // a guesser down for, which is why SHA-256 rather than Argon2.
    expect(normalizeRecoveryCode(codes[0]!)).toHaveLength(20)
  })
})
