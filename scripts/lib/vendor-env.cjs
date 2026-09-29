/**
 * Least-privilege environments for the vendor services (license server,
 * account portal).
 *
 * ecosystem.vendor.config.cjs used to hand both of them the entire Arciin
 * .env — DATABASE_URL, SESSION_SECRET, the vault key and everything else the
 * self-hosted API needs — although neither reads any of it. When the Postgres
 * password was rotated, the retired credential lived on in both processes'
 * PM2 state. Each service now receives only the keys its code reads; anything
 * else in .env simply never reaches it.
 *
 * Keep LICENSE_SERVER_ENV_KEYS in step with apps/license-server/src/env-files.ts
 * (tests/vendor-env-least-privilege.test.ts fails if they drift).
 */

/** Every variable apps/license-server reads (src/config.ts schema, index.ts, server.ts). */
const LICENSE_SERVER_ENV_KEYS = Object.freeze([
  "NODE_ENV",
  "LOG_LEVEL",
  "LICENSE_SERVER_HOST",
  "LICENSE_SERVER_PORT",
  "LICENSE_DATABASE_URL",
  "LICENSE_SIGNING_KEY",
  "LICENSE_SIGNING_KID",
  "LICENSE_SERVICE_TOKENS",
  "LICENSE_ADMIN_TOKENS",
  "LICENSE_LEGACY_HMAC_SECRET",
  "LICENSE_RATE_LIMIT_PER_MINUTE",
])

/** Every variable apps/account reads (lib/license-api.ts, next.config.ts). */
const ACCOUNT_ENV_KEYS = Object.freeze([
  "NODE_ENV",
  "LICENSE_SERVER_URL",
  "LICENSE_SERVICE_TOKEN",
  "LICENSE_ADMIN_TOKEN",
  "ARCIIN_PUBLIC_URL",
  "ARCIIN_ACCOUNT_ORIGINS",
  "NEXT_PUBLIC_ARCIIN_ACCOUNT_URL",
])

/** Only the listed keys, and only those actually set. */
function pickEnv(source, keys) {
  const out = {}
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== "") out[key] = value
  }
  return out
}

/** The PM2 `env` blocks for both vendor apps, built from a parsed .env. */
function buildVendorEnvs(dotenv) {
  const production = { NODE_ENV: "production", ARCIIN_ENV_NAMESPACE: "production" }
  return {
    licenseServer: { ...pickEnv(dotenv, LICENSE_SERVER_ENV_KEYS), ...production },
    account: { ...pickEnv(dotenv, ACCOUNT_ENV_KEYS), ...production },
  }
}

module.exports = { LICENSE_SERVER_ENV_KEYS, ACCOUNT_ENV_KEYS, pickEnv, buildVendorEnvs }
