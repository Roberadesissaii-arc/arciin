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

const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100"

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
        storageState: "test-results/.auth/e2e-user.json",
      },
      dependencies: ["setup"],
    },
  ],
})
