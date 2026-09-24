import path from "node:path"

import { config as loadEnv } from "dotenv"
import { defineConfig } from "vitest/config"

import { licensePublicKeyFromPrivate } from "./packages/config/src/license-signing"

/**
 * Integration suite: real PostgreSQL and a real Prisma client, pointed at a
 * dedicated `arciin_test` database and Redis db 15.
 *
 * Connection details are derived from `.env` at load time and never written
 * into this file — the repository must not carry credentials. Only the
 * database name and the Redis db index are swapped;
 * `tests/integration/guard.ts` then re-checks the result and aborts the run if
 * anything still resolves to a production value.
 */
loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true })

const TEST_DATABASE_NAME = "arciin_test"
const TEST_REDIS_DB = "15"
const TEST_DATA_DIR = "/tmp/arciin-integration-storage"

/**
 * A throwaway licensing authority for the suite.
 *
 * Entitlement tokens are now verified on the read path, so a test that needs a
 * *valid* paid licence has to sign one — which means this run must trust a key
 * whose private half the tests can hold. The same fixed test key the licensing
 * suite uses; it signs nothing real, and the production private key exists only
 * in the license server's environment.
 */
const LICENSE_TEST_SIGNING_KEY = "P1L5nJPd7wq0kUwqhU7SbXe0P4H2fT1YtGxWvBoNsRA"
const LICENSE_TEST_KID = "arciin-lic-test"

function testDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!raw) throw new Error("DATABASE_URL is required to derive the test database URL.")
  const url = new URL(raw)
  url.pathname = `/${TEST_DATABASE_NAME}`
  return url.toString()
}

function testRedisUrl(): string {
  const raw = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL
  if (!raw) throw new Error("REDIS_URL is required to derive the test Redis URL.")
  const url = new URL(raw)
  url.pathname = `/${TEST_REDIS_DB}`
  return url.toString()
}

export default defineConfig({
  resolve: {
    alias: {
      /**
       * API-internal `@/` first.
       *
       * Both apps use `@/`, and the web mapping below would swallow API
       * imports. Integration tests reach API modules by relative path, but the
       * modules they pull in resolve their *own* imports through this alias —
       * so a service that imports `@/services/...` needs it mapped here. The
       * prefix is unambiguous: `apps/web` has no `services/` directory.
       */
      "@/services/": `${path.resolve(__dirname, "apps/api/src/services")}/`,
      // Same reasoning: apps/web has no modules/ or plugins/ directory either.
      "@/modules/": `${path.resolve(__dirname, "apps/api/src/modules")}/`,
      "@/plugins/": `${path.resolve(__dirname, "apps/api/src/plugins")}/`,
      "@/config": path.resolve(__dirname, "apps/api/src/config"),
      "@/": `${path.resolve(__dirname, "apps/web")}/`,
      "@arciin/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@arciin/types": path.resolve(__dirname, "packages/types/src/index.ts"),
      "@arciin/config": path.resolve(__dirname, "packages/config/src/index.ts"),
      "@arciin/ui": path.resolve(__dirname, "packages/ui/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Shared database: run files serially so resetDatabase() in one file cannot
    // wipe rows another file is mid-way through asserting on.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: testDatabaseUrl(),
      REDIS_URL: testRedisUrl(),
      ARCIIN_DATA_DIR: TEST_DATA_DIR,
      NODE_ENV: "test",
      /**
       * Ports, so the isolation guard is satisfied rather than bypassed.
       *
       * Nothing here binds a socket — but importing an API service pulls in
       * `apps/api/src/config`, which refuses to load while the environment
       * still looks like production. That check is worth keeping honest, so the
       * suite declares dev ports instead of being exempted from it.
       */
      API_PORT: "4100",
      PORT: "3100",
      ARCIIN_QUEUE_PREFIX: "bull_test",
      ARCIIN_LICENSE_PUBLIC_KEYS: `${LICENSE_TEST_KID}:${licensePublicKeyFromPrivate(LICENSE_TEST_SIGNING_KEY)}`,
      /**
       * Isolated licensing authority for the purchase → activate chain.
       * dotenv will not overwrite these, so a developer .env cannot redirect
       * the suite at a real vendor key or production license database.
       */
      ARCIIN_LICENSE_SERVER_URL: "http://127.0.0.1:4398",
      LICENSE_DATABASE_URL: "file:/tmp/arciin-integration-license/licenses.db",
      LICENSE_SIGNING_KEY: LICENSE_TEST_SIGNING_KEY,
      LICENSE_SIGNING_KID: LICENSE_TEST_KID,
      LICENSE_SERVICE_TOKENS: "test-service-token-aaaaaaaaaaaaaaaaaaaa",
      LICENSE_ADMIN_TOKENS: "test-admin-token-bbbbbbbbbbbbbbbbbbbb",
      LICENSE_SERVER_PORT: "4398",
      LOG_LEVEL: "silent",
    },
  },
})
