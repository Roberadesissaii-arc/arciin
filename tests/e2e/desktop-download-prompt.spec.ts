import { readFileSync } from "node:fs"

import { expect, test, type Browser } from "@playwright/test"

const DOWNLOAD_URL = "https://www.arciin.com/download/windows"
const DISMISSED_KEY = "arciin:desktop-promo-dismissed:v1"

const OWNER_EMAIL = "e2e@arciin.invalid"
const PASSWORD_FILE = "/tmp/arciin-e2e-pw"

const WINDOWS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"

function ownerPassword() {
  return readFileSync(PASSWORD_FILE, "utf8").trim()
}

async function loginAsOwner(browser: Browser, baseURL: string | undefined, userAgent: string, extras?: {
  initScript?: string
}) {
  // Intentionally does not call suppressWindowsDesktopPromo — this spec is the
  // opt-in coverage for the Windows prompt.
  const context = await browser.newContext({
    storageState: undefined,
    baseURL,
    userAgent,
  })
  if (extras?.initScript) {
    await context.addInitScript(extras.initScript)
  }
  const page = await context.newPage()
  await page.goto("/login")
  await page.locator('input[type="email"]').fill(OWNER_EMAIL)
  await page.locator('input[type="password"]').first().fill(ownerPassword())
  await page.getByRole("button", { name: /sign in|log in|continue/i }).first().click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
  return { context, page }
}

test.describe("Windows Desktop acquisition", () => {
  test.setTimeout(180_000)

  test("Windows browser sees the prompt once, then Settings keeps the download", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await loginAsOwner(browser, baseURL, WINDOWS_UA)
    try {
      const promo = page.getByTestId("windows-desktop-promo")
      await expect(promo).toBeVisible({ timeout: 15_000 })
      await expect(promo.getByText("Get Arciin Desktop")).toBeVisible()
      await expect(promo.getByText("Find your Arciin server automatically")).toBeVisible()

      const download = promo.getByTestId("windows-desktop-download")
      await expect(download).toHaveAttribute("href", DOWNLOAD_URL)
      await expect(download).toHaveAttribute("target", "_blank")

      await promo.getByTestId("windows-desktop-continue").click()
      await expect(promo).toHaveCount(0)

      await page.goto("/files")
      await expect(page.getByTestId("windows-desktop-promo")).toHaveCount(0)
      const dismissed = await page.evaluate(
        (key) => window.localStorage.getItem(key),
        DISMISSED_KEY,
      )
      expect(dismissed).toBe("1")

      await page.goto("/settings?tab=devices")
      await expect(page.getByTestId("windows-desktop-settings-download")).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.getByTestId("windows-desktop-settings-download-link")).toHaveAttribute(
        "href",
        DOWNLOAD_URL,
      )
      await expect(page.getByRole("button", { name: "Generate Pairing Code" })).toBeVisible()
    } finally {
      await context.close()
    }
  })

  test("Arciin Desktop WebView never promotes downloading Desktop", async ({
    browser,
    baseURL,
  }) => {
    const { context, page } = await loginAsOwner(browser, baseURL, WINDOWS_UA, {
      initScript: "window.chrome = { ...(window.chrome || {}), webview: {} }",
    })
    try {
      await page.goto("/dashboard")
      await expect(page.getByTestId("windows-desktop-promo")).toHaveCount(0)
      await page.goto("/settings?tab=devices")
      await expect(page.getByRole("button", { name: "Devices" })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId("windows-desktop-settings-download")).toHaveCount(0)
    } finally {
      await context.close()
    }
  })

  test("macOS and Linux browsers do not auto-show the Windows installer", async ({
    browser,
    baseURL,
  }) => {
    const mac = await loginAsOwner(browser, baseURL, MAC_UA)
    try {
      await expect(mac.page.getByTestId("windows-desktop-promo")).toHaveCount(0)
      await mac.page.goto("/settings?tab=devices")
      await expect(mac.page.getByRole("button", { name: "Devices" })).toBeVisible({
        timeout: 30_000,
      })
      await expect(mac.page.getByTestId("windows-desktop-settings-download")).toHaveCount(0)
    } finally {
      await mac.context.close()
    }

    const linux = await loginAsOwner(
      browser,
      baseURL,
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    )
    try {
      await expect(linux.page.getByTestId("windows-desktop-promo")).toHaveCount(0)
    } finally {
      await linux.context.close()
    }
  })
})
