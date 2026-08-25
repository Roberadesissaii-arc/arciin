import path from "node:path"

import { config as loadEnv } from "dotenv"
import { defineConfig, devices } from "@playwright/test"

import { assertSafeE2ETarget } from "./tests/e2e/guard"

/**
 * Browser suite.
 *
 * Runs against the **isolated development stack** (web :3100, api :4100,
 * arciin_dev, Redis db 14, .next-dev) — never production. The guard below
 * throws before any browser starts if the target resolves to a production
 * port, database, Redis db, storage root, or queue prefix.
 */
loadEnv({ path: path.resolve(__dirname, ".env"), quiet: true })
loadEnv({ path: path.resolve(__dirname, ".env.development"), override: true, quiet: true })

/**
 * The suite gets its own ports, not the dev stack's.
 *
 * `pnpm dev` documents 3100/4100, but arciin-license-server permanently binds
 * 4100 on this machine, so booting a dev API there fails with EADDRINUSE and
 * the browser suite could never start. Using a dedicated pair also means a
 * developer's own `pnpm dev` and a test run can coexist.
 */
const E2E_WEB_PORT = process.env.E2E_WEB_PORT ?? "3300"
const E2E_API_PORT = process.env.E2E_API_PORT ?? "4300"
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${E2E_WEB_PORT}`

assertSafeE2ETarget({
  baseURL: BASE_URL,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  dataDir: process.env.ARCIIN_DATA_DIR,
  queuePrefix: process.env.ARCIIN_QUEUE_PREFIX,
  nodeEnv: process.env.NODE_ENV,
})

export default defineConfig({
  testDir: "./tests/e2e",
  /**
   * Seeds the dev owner account and writes its password before anything starts.
   *
   * Without this the suite could not run at all: auth.setup.ts read a password
   * file that nothing ever created, so every invocation died with ENOENT and
   * the browser tests had never once executed.
   */
  globalSetup: "./tests/e2e/global-setup.ts",
  /**
   * Boots the isolated stack if it is not already up. `reuseExistingServer`
   * means a developer who already has one running keeps it; CI gets a fresh
   * one. Production is on 4000/3002 and is never touched — the guard above
   * refuses those ports outright.
   *
   * The web app is **built and served, not run under `next dev`**. Two reasons,
   * in order of importance:
   *
   * 1. `next dev` compiles a route the first time it is requested, so the first
   *    assertion to touch a page was really measuring a compile. It passed or
   *    failed on whether an earlier run had left a warm cache behind.
   * 2. Worse, that compile is not merely slow. On Next 16.2.6 the dev compiler
   *    deadlocks on `/dashboard`: the request never returns, and every Turbopack
   *    worker sits parked in `futex_do_wait` at 0% CPU indefinitely — observed
   *    at >8 minutes with no completion. The same route builds in 56s and then
   *    serves in 0.16s here. Signing in navigates to `/dashboard`, so the login
   *    step inherited that hang and looked like a broken login.
   *
   * The build costs about two minutes once, and buys back more than that in dev
   * compiles that no longer happen. It also means the suite certifies the
   * artefact that actually ships rather than one that never leaves a laptop.
   */
  webServer: [
    {
      command: `ARCIIN_ENV_NAMESPACE=dev API_PORT=${E2E_API_PORT} tsx --tsconfig apps/api/tsconfig.json apps/api/src/index.ts`,
      url: `http://127.0.0.1:${E2E_API_PORT}/api/health`,
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // NODE_ENV=production for this child only. `.env.development` above sets
      // it to development, and `next build` under that value fails while
      // prerendering with "Cannot read properties of null (reading
      // 'useState')". The guard reads NODE_ENV from this config's own process,
      // which stays as it was.
      command:
        `NODE_ENV=production ARCIIN_ENV_NAMESPACE=dev NEXT_DIST_DIR=.next-e2e ARCIIN_API_URL=http://127.0.0.1:${E2E_API_PORT} pnpm --filter @arciin/web build && ` +
        `NODE_ENV=production ARCIIN_ENV_NAMESPACE=dev PORT=${E2E_WEB_PORT} NEXT_DIST_DIR=.next-e2e ARCIIN_API_URL=http://127.0.0.1:${E2E_API_PORT} pnpm --filter @arciin/web start -p ${E2E_WEB_PORT}`,
      url: `http://127.0.0.1:${E2E_WEB_PORT}/login`,
      reuseExistingServer: true,
      // Covers a cold production build, not just the boot that follows it.
      timeout: 900_000,
      stdout: "ignore",
      stderr: "pipe",
    },
  ],
  testMatch: /\.(spec|setup)\.ts$/,
  // The entitlement tests hard-refresh 20 times; give them room.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  // Serial: the suite drives one shared dev instance.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { outputFolder: "reports/playwright", open: "never" }]],
  use: {
    baseURL: BASE_URL,
    // Artifacts only on failure — a green run should not fill the disk.
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    // Signs in once against the seeded dev instance and saves the session.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".playwright-auth/e2e-user.json",
      },
      dependencies: ["setup"],
    },
  ],
})
