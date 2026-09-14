import { readFileSync } from "node:fs"

import { expect, test, type Browser, type Page } from "@playwright/test"

import { newUnauthedContext } from "./desktop-promo"

const OWNER_EMAIL = "e2e@arciin.invalid"
const PASSWORD_FILE = "/tmp/arciin-e2e-pw"
const ROLE_FILE = "/tmp/arciin-e2e-role-users.json"

type RoleCreds = {
  member: { email: string; password: string }
}

function ownerPassword() {
  return readFileSync(PASSWORD_FILE, "utf8").trim()
}

function roleCreds(): RoleCreds {
  return JSON.parse(readFileSync(ROLE_FILE, "utf8")) as RoleCreds
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login")
  await page.locator('input[type="email"]').fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.getByRole("button", { name: /sign in|log in|continue/i }).first().click()
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 })
}

async function freshContext(browser: Browser, baseURL: string | undefined) {
  const context = await newUnauthedContext(browser, { baseURL })
  const page = await context.newPage()
  return { context, page }
}

test.describe.configure({ mode: "serial" })

test.describe("Settings → Devices", () => {
  test.setTimeout(240_000)

  test("OWNER can pair, see, and revoke a device", async ({ browser, baseURL }) => {
    const { context, page } = await freshContext(browser, baseURL)
    const desktop = await newUnauthedContext(browser, { baseURL })

    try {
      await login(page, OWNER_EMAIL, ownerPassword())
      await page.goto("/settings?tab=devices")
      await expect(page.getByRole("button", { name: "Devices" })).toBeVisible({ timeout: 30_000 })
      const existing = await page.request.get("/api/settings/devices")
      if (existing.ok()) {
        const snapshot = (await existing.json()) as { data: { devices: { id: string }[] } }
        for (const device of snapshot.data.devices) {
          await page.request.post(`/api/settings/devices/${device.id}/revoke`)
        }
      }
      await page.reload()
      await expect(page.getByRole("button", { name: "Generate Pairing Code" })).toBeVisible()
      await expect(page.getByText("No trusted devices yet.")).toBeVisible()

      await page.getByRole("button", { name: "Generate Pairing Code" }).click()
      const codePanel = page.getByTestId("device-pairing-code")
      await expect(codePanel).toBeVisible()
      await expect(codePanel.getByRole("button", { name: "Copy", exact: true })).toBeVisible()
      const display = await codePanel.locator("p.font-mono").first().textContent()
      expect(display?.replace(/\s+/g, "")).toMatch(/^\d{6}$/)
      await expect(codePanel.getByText(/Expires in/)).toBeVisible()

      const code = display?.replace(/\D/g, "") ?? ""
      const pair = await desktop.request.post("/api/devices/pair", {
        data: {
          code,
          name: "Robera Desktop",
          platform: "windows",
          deviceType: "desktop",
          protocolVersion: 1,
          appVersion: "0.1.0",
        },
      })
      expect(pair.ok()).toBeTruthy()
      const paired = (await pair.json()) as {
        data: { credential: string; device: { id: string } }
      }
      expect(paired.data.credential).toBeTruthy()

      const bootstrap = await desktop.request.post("/api/devices/session", {
        headers: { Authorization: `Device ${paired.data.credential}` },
      })
      expect(bootstrap.ok()).toBeTruthy()

      const ownerLogin = await desktop.request.post("/api/auth/login", {
        data: { email: OWNER_EMAIL, password: ownerPassword() },
      })
      expect(ownerLogin.ok()).toBeTruthy()
      const meBefore = await desktop.request.get("/api/auth/me")
      expect(meBefore.ok()).toBeTruthy()

      await page.reload()
      await expect(page.getByText("Robera Desktop")).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText("Windows · Desktop")).toBeVisible()
      await expect(page.getByTestId("device-card-other")).toBeVisible()
      await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Revoke access" })).toHaveCount(0)
      await page.getByTestId("other-device-menu").click()
      await expect(page.getByTestId("revoke-access")).toBeVisible()

      await page.getByTestId("revoke-access").click()
      await expect(page.getByRole("heading", { name: /Revoke access for Robera Desktop/ })).toBeVisible()
      await page.getByRole("button", { name: "Revoke Access" }).click()
      await expect(page.getByText("No trusted devices yet.")).toBeVisible({ timeout: 30_000 })

      const meAfter = await desktop.request.get("/api/auth/me")
      expect(meAfter.status()).toBe(401)

      const stillOwner = await page.request.get("/api/auth/me")
      expect(stillOwner.ok()).toBeTruthy()
    } finally {
      await desktop.close()
      await context.close()
    }
  })

  test("MEMBER cannot manage trusted devices", async ({ browser, baseURL }) => {
    const { context, page } = await freshContext(browser, baseURL)
    try {
      const member = roleCreds().member
      await login(page, member.email, member.password)
      const created = await page.request.post("/api/settings/devices/pairing")
      expect(created.status()).toBe(403)
      const listed = await page.request.get("/api/settings/devices")
      expect(listed.status()).toBe(403)
    } finally {
      await context.close()
    }
  })

  test("device-bound session marks This device and hides generic Revoke", async ({
    browser,
    baseURL,
  }) => {
    const { context: ownerContext, page: ownerPage } = await freshContext(browser, baseURL)
    const desktop = await newUnauthedContext(browser, { baseURL })
    const desktopPage = await desktop.newPage()
    try {
      await login(ownerPage, OWNER_EMAIL, ownerPassword())
      const existing = await ownerPage.request.get("/api/settings/devices")
      if (existing.ok()) {
        const snapshot = (await existing.json()) as { data: { devices: { id: string }[] } }
        for (const device of snapshot.data.devices) {
          await ownerPage.request.post(`/api/settings/devices/${device.id}/revoke`)
        }
      }

      await ownerPage.goto("/settings?tab=devices")
      await expect(ownerPage.getByRole("button", { name: "Generate Pairing Code" })).toBeVisible()
      await ownerPage.getByRole("button", { name: "Generate Pairing Code" }).click()
      const display = await ownerPage.getByTestId("device-pairing-code").locator("p.font-mono").first().textContent()
      const code = display?.replace(/\D/g, "") ?? ""
      const pair = await desktop.request.post("/api/devices/pair", {
        data: {
          code,
          name: "Robera Desktop",
          platform: "windows",
          deviceType: "desktop",
          protocolVersion: 1,
          appVersion: "0.1.0",
        },
      })
      expect(pair.ok()).toBeTruthy()
      const paired = (await pair.json()) as { data: { credential: string; device: { id: string } } }

      const bootstrap = await desktop.request.post("/api/devices/session", {
        headers: { Authorization: `Device ${paired.data.credential}` },
      })
      expect(bootstrap.ok()).toBeTruthy()

      await login(desktopPage, OWNER_EMAIL, ownerPassword())

      const desktopMe = await desktopPage.request.get("/api/auth/me")
      expect(desktopMe.ok()).toBeTruthy()
      const desktopSession = (await desktopMe.json()) as {
        data: { session: { pairedDeviceId: string | null } | null }
      }
      expect(desktopSession.data.session?.pairedDeviceId).toBe(paired.data.device.id)

      const ownerMe = await ownerPage.request.get("/api/auth/me")
      expect(ownerMe.ok()).toBeTruthy()
      const ownerSession = (await ownerMe.json()) as {
        data: { session: { pairedDeviceId: string | null } | null }
      }
      expect(ownerSession.data.session?.pairedDeviceId).toBeNull()

      const listed = await desktopPage.request.get("/api/settings/devices")
      expect(listed.ok()).toBeTruthy()
      const snapshot = (await listed.json()) as {
        data: { currentDeviceId: string | null; devices: Array<{ id: string; isCurrentDevice: boolean }> }
      }
      expect(snapshot.data.currentDeviceId).toBe(paired.data.device.id)
      expect(snapshot.data.devices[0]?.isCurrentDevice).toBe(true)

      await desktopPage.goto("/settings?tab=devices")
      const currentCard = desktopPage.getByTestId("device-card-current")
      await expect(currentCard).toBeVisible()
      await expect(currentCard.getByText("This device")).toBeVisible()
      await expect(currentCard.getByText("Connected")).toBeVisible()
      await expect(currentCard.getByTestId("turn-on-backup")).toBeVisible()
      await expect(currentCard.getByText("Not enabled")).toBeVisible()
      await expect(currentCard.getByText("Open Arciin Desktop to turn on backup.")).toBeVisible()
      await currentCard.getByTestId("turn-on-backup").click()
      await expect(desktopPage).toHaveURL(/\/settings/)
      expect(
        await desktopPage.evaluate(
          () => (window as Window & { __arciinNativeBackupSetupIntent?: string }).__arciinNativeBackupSetupIntent,
        ),
      ).toBeUndefined()

      await desktopPage.evaluate(() => {
        Object.defineProperty(window, "chrome", {
          configurable: true,
          value: { webview: {} },
        })
      })
      await currentCard.getByTestId("turn-on-backup").click()
      await expect(desktopPage).toHaveURL(/\/settings/)
      expect(
        await desktopPage.evaluate(
          () => (window as Window & { __arciinNativeBackupSetupIntent?: string }).__arciinNativeBackupSetupIntent,
        ),
      ).toBe("arciin-native://backup/setup")
      await expect(desktopPage.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0)
      await expect(desktopPage.getByRole("button", { name: "Revoke access" })).toHaveCount(0)

      const enabled = await desktopPage.request.post("/api/backup/profiles", {
        data: {
          deviceId: paired.data.device.id,
          roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-root" }],
        },
      })
      expect(enabled.ok()).toBeTruthy()
      await desktopPage.reload()
      const currentEnabled = desktopPage.getByTestId("device-card-current")
      await expect(currentEnabled.getByTestId("manage-backup")).toBeVisible()
      await expect(currentEnabled.getByTestId("turn-on-backup")).toHaveCount(0)
      await expect(currentEnabled.getByText("Computer Backup")).toBeVisible()
      await expect(currentEnabled.getByText(/1 folder protected/)).toBeVisible()
      await expect(currentEnabled.getByText(/Last backup/)).toBeVisible()
      await expect(currentEnabled.getByText("Open Arciin Desktop to manage protected folders.")).toBeVisible()
      await expect(currentEnabled.getByRole("button", { name: "Disable Backup" })).toHaveCount(0)
      await currentEnabled.getByTestId("manage-backup").click()
      await expect(desktopPage).toHaveURL(/\/settings/)
      expect(
        await desktopPage.evaluate(
          () => (window as Window & { __arciinNativeBackupSetupIntent?: string }).__arciinNativeBackupSetupIntent,
        ),
      ).toBeUndefined()
      await desktopPage.evaluate(() => {
        Object.defineProperty(window, "chrome", {
          configurable: true,
          value: { webview: {} },
        })
      })
      await currentEnabled.getByTestId("manage-backup").click()
      expect(
        await desktopPage.evaluate(
          () => (window as Window & { __arciinNativeBackupSetupIntent?: string }).__arciinNativeBackupSetupIntent,
        ),
      ).toBe("arciin-native://backup/setup")

      await desktopPage.getByTestId("current-device-menu").click()
      await expect(desktopPage.getByTestId("disconnect-this-computer")).toBeVisible()
      await desktopPage.getByTestId("disconnect-this-computer").click()
      await expect(desktopPage.getByRole("heading", { name: /Disconnect Robera Desktop/ })).toBeVisible()
      const [revokeRes] = await Promise.all([
        desktopPage.waitForResponse(
          (response) =>
            response.url().includes("/revoke") && response.request().method() === "POST",
        ),
        desktopPage.getByRole("button", { name: "Disconnect Computer" }).click(),
      ])
      expect(revokeRes.ok()).toBeTruthy()
      const me = await desktopPage.request.get("/api/auth/me")
      expect(me.status()).toBe(401)
    } finally {
      await desktop.close()
      await ownerContext.close()
    }
  })
})

