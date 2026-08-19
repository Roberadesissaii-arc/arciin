/**
 * Environment for the licensing suite, shared between the vitest config (which
 * passes it to the test workers) and the global setup (which runs before that
 * env exists and so has to import the values directly).
 */

/** Throwaway database. Under /tmp so the suite can never reach real licensing data. */
export const LICENSE_TEST_DB_PATH = "/tmp/arciin-license-test/licenses.db"
export const LICENSE_TEST_DB_URL = `file:${LICENSE_TEST_DB_PATH}`

/**
 * Fixed Ed25519 test key. Safe to commit: it signs nothing real, and the
 * production key exists only in the license server's environment.
 */
export const LICENSE_TEST_SIGNING_KEY = "P1L5nJPd7wq0kUwqhU7SbXe0P4H2fT1YtGxWvBoNsRA"
export const LICENSE_TEST_SIGNING_KID = "arciin-lic-test"

export const LICENSE_TEST_SERVICE_TOKEN = "test-service-token-aaaaaaaaaaaaaaaaaaaa"
export const LICENSE_TEST_ADMIN_TOKEN = "test-admin-token-bbbbbbbbbbbbbbbbbbbb"

export const licenseTestEnv = {
  NODE_ENV: "test",
  LICENSE_DATABASE_URL: LICENSE_TEST_DB_URL,
  LICENSE_SIGNING_KEY: LICENSE_TEST_SIGNING_KEY,
  LICENSE_SIGNING_KID: LICENSE_TEST_SIGNING_KID,
  LICENSE_SERVICE_TOKENS: LICENSE_TEST_SERVICE_TOKEN,
  LICENSE_ADMIN_TOKENS: LICENSE_TEST_ADMIN_TOKEN,
  LICENSE_SERVER_PORT: "4399",
} as const
