import path from "node:path"

import { defineConfig } from "vitest/config"

/**
 * Unit tests only — deliberately no database, Redis, or storage-root access.
 *
 * The logic these cover (classification rules, upload lifecycle transitions,
 * visible-asset query construction, upload-queue merge ordering) is factored
 * into pure functions precisely so it can be asserted without touching the
 * running instance. Integration coverage against an isolated Postgres/Redis is
 * a separate, still-outstanding piece of work.
 */
export default defineConfig({
  resolve: {
    alias: {
      // The web app's own alias. API and worker code under test is imported by
      // relative path instead, so a single "@/" mapping is unambiguous here.
      "@/": `${path.resolve(__dirname, "apps/web")}/`,
      "@arciin/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@arciin/types": path.resolve(__dirname, "packages/types/src/index.ts"),
      "@arciin/config": path.resolve(__dirname, "packages/config/src/index.ts"),
      "@arciin/ui": path.resolve(__dirname, "packages/ui/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    /**
     * Vitest defaults to 5s. Several suites shell out to repo scripts
     * (verify-install-parity.sh, build-backend, the healthcheck probes), which
     * take ~0.2s on a warm developer machine and have repeatedly taken ~10s on
     * a cold, contended GitHub runner. That made "Unit, license, integration"
     * fail three separate times on a timeout alone, with no assertion broken —
     * a required check turning red for reasons unrelated to the code under it.
     *
     * A longer ceiling does not slow a passing test down; it only changes how
     * long a genuinely hung one waits before failing.
     */
    testTimeout: 30_000,
    hookTimeout: 30_000,
    include: [
      "tests/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
    ],
    // Integration tests need a real database and their own env; they run via
    // vitest.integration.config.ts (`pnpm test:integration`).
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "tests/integration/**",
      // Its own project: the worker needs `@/` pointing at apps/worker/src, and
      // a real database. See vitest.worker.config.ts (`pnpm test:worker`).
      "tests/worker/**",
      // Its own project: the licensing authority resolves signing keys and
      // service credentials at import time, so its environment has to exist
      // before the modules load. See vitest.license.config.ts
      // (`pnpm test:license`).
      "tests/license-server/**",
    ],
    // Never let a stray import reach the live instance.
    env: {
      DATABASE_URL: "postgresql://test:test@127.0.0.1:1/arciin_test_never_used",
      REDIS_URL: "redis://127.0.0.1:1/15",
      ARCIIN_DATA_DIR: "/tmp/arciin-test-storage",
    },
  },
})
