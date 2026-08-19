import { describe, expect, it } from "vitest"

import {
  DEV_LICENSE_SIGNING_SECRET,
  isWeakProductionSecret,
  resolveLegacyLicenseSecretFrom,
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

describe("resolveLegacyLicenseSecretFrom", () => {
  const prod = { isProduction: true }
  const dev = { isProduction: false }

  /**
   * Entitlement tokens are Ed25519-signed and verified with a public key that
   * ships in the source, so a normal install configures no licensing secret at
   * all. What remains is a transition path: an instance that activated before
   * the migration still holds a v2 token and needs the old HMAC secret until
   * its next refresh swaps it for v3.
   *
   * So "nothing configured" is now the healthy state, not a boot failure — but
   * the bundled development value must still be refused, because accepting it
   * would restore exactly the forgeable setup v3 replaced.
   */

  it("returns null when nothing is configured — the normal case", () => {
    expect(
      resolveLegacyLicenseSecretFrom({ configured: undefined, fallback: undefined, ...prod }),
    ).toBeNull()
    expect(
      resolveLegacyLicenseSecretFrom({ configured: undefined, fallback: undefined, ...dev }),
    ).toBeNull()
  })

  it("treats an empty or whitespace value as unset", () => {
    expect(resolveLegacyLicenseSecretFrom({ configured: "   ", fallback: null, ...prod })).toBeNull()
  })

  it("refuses the bundled development secret in production", () => {
    // The exact regression this guard exists for: this value is in the repository.
    expect(() =>
      resolveLegacyLicenseSecretFrom({
        configured: DEV_LICENSE_SIGNING_SECRET,
        fallback: undefined,
        ...prod,
      }),
    ).toThrow(/public key/)
  })

  it("refuses a weak legacy value in production rather than half-trusting it", () => {
    expect(() =>
      resolveLegacyLicenseSecretFrom({ configured: "change-me", fallback: undefined, ...prod }),
    ).toThrow()
    expect(() =>
      resolveLegacyLicenseSecretFrom({ configured: "a".repeat(31), fallback: undefined, ...prod }),
    ).toThrow()
  })

  it("accepts a strong legacy secret during the migration window", () => {
    expect(
      resolveLegacyLicenseSecretFrom({ configured: STRONG, fallback: undefined, ...prod }),
    ).toBe(STRONG)
  })

  it("accepts one supplied through the LICENSE_SIGNING_SECRET fallback", () => {
    expect(
      resolveLegacyLicenseSecretFrom({ configured: undefined, fallback: STRONG, ...prod }),
    ).toBe(STRONG)
  })

  it("tolerates the development secret outside production", () => {
    expect(
      resolveLegacyLicenseSecretFrom({
        configured: DEV_LICENSE_SIGNING_SECRET,
        fallback: undefined,
        ...dev,
      }),
    ).toBe(DEV_LICENSE_SIGNING_SECRET)
  })

  it("never reports the secret in the error message", () => {
    const leaky = "supersecretvalue-that-must-not-appear"
    try {
      resolveLegacyLicenseSecretFrom({ configured: leaky, fallback: undefined, ...prod })
    } catch (error) {
      expect(String(error)).not.toContain(leaky)
    }
  })
})
