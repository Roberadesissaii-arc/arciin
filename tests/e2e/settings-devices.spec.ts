import { readFileSync } from "node:fs"

import { expect, test, type Browser, type Page } from "@playwright/test"

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
  const context = await browser.newContext({ storageState: undefined, baseURL })
  const page = await context.newPage()
  return { context, page }
}

test.describe.configure({ mode: "serial" })

test.describe("Settings → Devices", () => {
  test.setTimeout(240_000)

  test("OWNER can pair, see, and revoke a device", async ({ browser, baseURL }) => {
    const { context, page } = await freshContext(browser, baseURL)
    const desktop = await browser.newContext({ storageState: undefined, baseURL })

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
      await expect(page.getByText("Active").first()).toBeVisible()

      await page.getByRole("button", { name: "Revoke" }).click()
      await expect(page.getByRole("heading", { name: /Revoke Robera Desktop/ })).toBeVisible()
      await page.getByRole("button", { name: "Revoke Device" }).click()
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
})

