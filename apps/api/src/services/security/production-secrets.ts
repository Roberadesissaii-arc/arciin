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
 * Resolve the license verification secret for a given environment.
 *
 * Returns the secret, or throws with an actionable message. Pure: the caller
 * supplies the environment so this can be exercised for production without
 * setting NODE_ENV globally.
 */
export function resolveLicenseVerifySecretFrom(input: {
  configured: string | undefined | null
  fallback: string | undefined | null
  isProduction: boolean
}): string {
  const configured = (input.configured || input.fallback || "").trim()

  if (!input.isProduction) {
    return configured || DEV_LICENSE_SIGNING_SECRET
  }

  if (
    !configured ||
    configured === DEV_LICENSE_SIGNING_SECRET ||
    isWeakProductionSecret(configured, { minLen: 32 })
  ) {
    throw new Error(
      "ARCIIN_LICENSE_VERIFY_SECRET must be a strong random value in production (min 32 chars, and not the bundled development secret). Generate one with: openssl rand -hex 32 — it must match LICENSE_SIGNING_SECRET on the license server.",
    )
  }

  return configured
}
