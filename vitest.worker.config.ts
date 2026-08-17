import path from "node:path"

import { config as loadEnv } from "dotenv"
import { defineConfig } from "vitest/config"

/**
 * Integration suite: real PostgreSQL and a real Prisma client, pointed at a
 * dedicated `arciin_test` database and Redis db 15.
 *
 * Split from `vitest.integration.config.ts` only because of the `@/` alias: the
 * worker's handlers import `@/services/...` from `apps/worker/src`, while the
 * integration suite maps that prefix to `apps/api/src`. Everything else — the
 * database, the storage root, the isolation guard — is identical.
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
       * The worker owns `@/` here.
       *
       * Three apps use the same prefix for three different roots, and one
       * config can only pick one. The integration suite maps it to the API,
       * which leaves the worker's own `@/services/auto-update` resolving to a
       * file that does not exist — hence this separate project, rather than an
       * alias order that would have to be wrong for one suite or the other.
       */
      "@/": `${path.resolve(__dirname, "apps/worker/src")}/`,
      /**
       * To source, so the dub tests can mock it.
       *
       * Resolved through node_modules it is an external dependency, and vitest
       * does not intercept those — `vi.mock("@arciin/media-ai")` silently did
       * nothing, and the worker called the real Gemini resolver.
       */
      "@arciin/media-ai": path.resolve(__dirname, "packages/media-ai/src/index.ts"),
      "@arciin/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@arciin/types": path.resolve(__dirname, "packages/types/src/index.ts"),
      "@arciin/config": path.resolve(__dirname, "packages/config/src/index.ts"),
      "@arciin/ui": path.resolve(__dirname, "packages/ui/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/worker/**/*.test.ts"],
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
    },
  },
})
