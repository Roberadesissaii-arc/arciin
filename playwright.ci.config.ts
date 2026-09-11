import config from "./playwright.config"

/**
 * Deterministic browser gates for CI (ARC-011).
 *
 * The full Playwright tree includes long media/visual specs and optional
 * provider smokes. CI runs the product-critical paths that do not need
 * private production credentials.
 */
const ciConfig = {
  ...config,
  testMatch: /\/(login|users-admin|entitlement|transcript-card-realtime|files-upload|settings-lan)\.spec\.ts$/,
  webServer: config.webServer?.map((server) => ({
    ...server,
    reuseExistingServer: !process.env.CI,
  })),
}

export default ciConfig
