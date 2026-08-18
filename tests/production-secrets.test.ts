import { describe, expect, it } from "vitest"

import {
  DEV_LICENSE_SIGNING_SECRET,
  isWeakProductionSecret,
  resolveLicenseVerifySecretFrom,
} from "../apps/api/src/services/security/production-secrets"

/**
 * Production secret guards.
 *
 * SESSION_SECRET and ARCIIN_SETUP_TOKEN already refused to start on a
 * placeholder. The license signing secret did not — it fell back to a value
 * committed in this repository, so an instance that never configured one
 * verified license signatures against a string anyone could read, and any
 * forged license unlocked every paid feature. These tests hold all three to the
 * same rule.
 */

const STRONG = "9f2c1b7ae4d6538190ac47bd2e5f8c31a6b904de7f21c8355ea0d9471b6c2f83"

describe("isWeakProductionSecret", () => {
  it("rejects anything shorter than the required length", () => {
    expect(isWeakProductionSecret("short", { minLen: 32 })).toBe(true)
    expect(isWeakProductionSecret("a".repeat(31), { minLen: 32 })).toBe(true)
    expect(isWeakProductionSecret("a".repeat(32), { minLen: 32 })).toBe(false)
  })

  it.each(["dev-token", "change-me", "changeme", "password", "secret", "arciin", "test", "example", "default"])(
    "rejects the placeholder %s",
    (value) => {
      expect(isWeakProductionSecret(value, { minLen: 1 })).toBe(true)
    },
  )

  it("rejects the shipped change-this-in-production default", () => {
    expect(
      isWeakProductionSecret("change-this-in-production-must-be-32-chars-min", { minLen: 32 }),
    ).toBe(true)
  })

  it("is case- and whitespace-insensitive about placeholders", () => {
    expect(isWeakProductionSecret("  Change-Me  ", { minLen: 1 })).toBe(true)
  })

  it("accepts a strong random value", () => {
    expect(isWeakProductionSecret(STRONG, { minLen: 32 })).toBe(false)
  })

  it("does not reject random hex that merely starts like a placeholder", () => {
    // "secretive..." is not the placeholder "secret" — prefix matching here
    // would refuse legitimate values.
    expect(isWeakProductionSecret(`secretive${STRONG}`, { minLen: 32 })).toBe(false)
  })
})

describe("resolveLicenseVerifySecretFrom — production", () => {
  const prod = { isProduction: true }

  it("throws when nothing is configured", () => {
    expect(() =>
      resolveLicenseVerifySecretFrom({ configured: undefined, fallback: undefined, ...prod }),
    ).toThrow(/ARCIIN_LICENSE_VERIFY_SECRET/)
  })

  it("throws on an empty or whitespace value", () => {
    expect(() =>
      resolveLicenseVerifySecretFrom({ configured: "   ", fallback: null, ...prod }),
    ).toThrow(/ARCIIN_LICENSE_VERIFY_SECRET/)
  })

  it("throws on the bundled development secret", () => {
    // The exact regression: this value is in the repository.
    expect(() =>
      resolveLicenseVerifySecretFrom({
        configured: DEV_LICENSE_SIGNING_SECRET,
        fallback: undefined,
        ...prod,
      }),
    ).toThrow(/not the bundled development secret/)
  })

  it("throws on a weak or too-short value", () => {
    expect(() =>
      resolveLicenseVerifySecretFrom({ configured: "change-me", fallback: undefined, ...prod }),
    ).toThrow()
    expect(() =>
      resolveLicenseVerifySecretFrom({ configured: "a".repeat(31), fallback: undefined, ...prod }),
    ).toThrow()
  })

  it("accepts a strong value", () => {
    expect(
      resolveLicenseVerifySecretFrom({ configured: STRONG, fallback: undefined, ...prod }),
    ).toBe(STRONG)
  })

  it("accepts a strong value supplied via the LICENSE_SIGNING_SECRET fallback", () => {
    expect(
      resolveLicenseVerifySecretFrom({ configured: undefined, fallback: STRONG, ...prod }),
    ).toBe(STRONG)
  })

  it("never reports the secret in the error message", () => {
    const leaky = "supersecretvalue-that-must-not-appear"
    try {
      resolveLicenseVerifySecretFrom({ configured: leaky, fallback: undefined, ...prod })
    } catch (error) {
      expect(String(error)).not.toContain(leaky)
    }
  })
})

describe("resolveLicenseVerifySecretFrom — development", () => {
  const dev = { isProduction: false }

  it("falls back to the bundled dev secret so local work needs no setup", () => {
    expect(
      resolveLicenseVerifySecretFrom({ configured: undefined, fallback: undefined, ...dev }),
    ).toBe(DEV_LICENSE_SIGNING_SECRET)
  })

  it("still prefers a configured value when there is one", () => {
    expect(
      resolveLicenseVerifySecretFrom({ configured: STRONG, fallback: undefined, ...dev }),
    ).toBe(STRONG)
  })
})
