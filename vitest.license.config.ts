import path from "node:path"

import { defineConfig } from "vitest/config"

import { licenseTestEnv } from "./tests/license-server/test-env"

/**
 * Licensing authority suite.
 *
 * Its own project because the license server is a separate service with a
 * separate database: SQLite rather than Postgres, its own Prisma client, and
 * environment that must be set before `src/config.ts` is imported (it resolves
 * signing keys and service credentials at module load). The unit suite
 * deliberately touches none of that.
 *
 * Every run gets a throwaway database created by the global setup, so these
 * tests can never reach the development licensing data in
 * `apps/license-server/data/`.
 */

export default defineConfig({
  resolve: {
    alias: {
      // Subpath first: a bare "@arciin/config" prefix would swallow it.
      "@arciin/config/client": path.resolve(__dirname, "packages/config/src/client.ts"),
      "@arciin/config": path.resolve(__dirname, "packages/config/src/index.ts"),
      "@arciin/types": path.resolve(__dirname, "packages/types/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/license-server/**/*.test.ts"],
    globalSetup: ["tests/license-server/global-setup.ts"],
    // One SQLite file, shared. Serial so a reset in one file cannot land in the
    // middle of another file's assertions.
    fileParallelism: false,
    testTimeout: 20_000,
    env: { ...licenseTestEnv },
  },
})
