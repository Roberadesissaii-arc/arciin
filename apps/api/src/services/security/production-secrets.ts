/**
 * Rules for what may act as a production secret.
 *
 * Extracted from config.ts so they can be asserted directly — the guards are
 * only worth having if their edges are pinned, and a test that has to boot the
 * whole config module to ask "is this value refused?" cannot cover them.
 *
 * The philosophy is uniform across SESSION_SECRET, ARCIIN_SETUP_TOKEN and
 * ARCIIN_LICENSE_VERIFY_SECRET: in production a missing, placeholder or short
 * value stops the boot. The alternative — starting anyway — means the instance
 * runs on a value printed in this repository, and nothing about its behaviour
 * says so.
 */

/**
 * The license signing secret bundled for local development.
 *
 * This used to be an unguarded `||` fallback inside the license client, so an
 * instance with nothing configured verified signatures against a string anyone
 * could read here — i.e. anyone could mint a license unlocking every paid
 * feature. Named as a constant so the guard can reject it by value.
 */
export const DEV_LICENSE_SIGNING_SECRET = "arciin-dev-license-signing-secret-change-me"

/** Values that must never ship as live production secrets for a public self-hosted instance. */
export function isWeakProductionSecret(
  value: string,
  { minLen }: { minLen: number },
): boolean {
  const v = value.trim().toLowerCase()
  if (v.length < minLen) return true

  // Exact placeholders only — a prefix match would reject random hex that
  // happens to begin with one of these.
  const exact = new Set([
    "dev-token",
    "change-me",
    "changeme",
    "password",
    "secret",
    "arciin",
    "test",
    "example",
    "default",
  ])
  if (exact.has(v)) return true

  if (v.startsWith("change-this-in-production")) return true
  if (v.startsWith("change-me")) return true

  return false
}

/**
 * Resolve the *legacy* v2 HMAC verification secret, if one is configured.
 *
 * Entitlement tokens are Ed25519-signed (v3) and verified with a public key
 * that ships in the source — so a normal install needs no secret at all, and
 * `install.sh` no longer mints one. This exists only for the transition: an
 * instance that activated before the migration still holds a v2 token, and
 * keeps verifying it until its next refresh swaps it for v3.
 *
 * Returns null when nothing is configured, which is the expected state for
 * every new install. The bundled development value is still refused outright —
 * accepting it would reintroduce exactly the forgeable setup v3 replaced.
 */
export function resolveLegacyLicenseSecretFrom(input: {
  configured: string | undefined | null
  fallback: string | undefined | null
  isProduction: boolean
}): string | null {
  const configured = (input.configured || input.fallback || "").trim()
  if (!configured) return null

  if (configured === DEV_LICENSE_SIGNING_SECRET) {
    if (input.isProduction) {
      throw new Error(
        "ARCIIN_LICENSE_VERIFY_SECRET is set to the bundled development value. Remove it — entitlement tokens are verified with the public key that ships with Arciin.",
      )
    }
    return configured
  }

  if (input.isProduction && isWeakProductionSecret(configured, { minLen: 32 })) {
    throw new Error(
      "ARCIIN_LICENSE_VERIFY_SECRET is set but too weak to be a legacy verification secret. Remove it unless this instance is mid-migration from a v2 token.",
    )
  }

  return configured
}
