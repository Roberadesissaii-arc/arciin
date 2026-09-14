import { readFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type Browser, type Page } from "@playwright/test"

const IMAGE_FIXTURE = path.resolve(__dirname, "../fixtures/e2e-image-fixture.png")
const PDF_FIXTURE = path.resolve(__dirname, "../fixtures/e2e-doc-fixture.pdf")
const VIDEO_FIXTURE = path.resolve(__dirname, "../fixtures/e2e-video-transcript-fixture.mp4")

const ROLE_FILE = "/tmp/arciin-e2e-role-users.json"

function roleCreds(): { member: { email: string; password: string } } {
  return JSON.parse(readFileSync(ROLE_FILE, "utf8")) as {
    member: { email: string; password: string }
  }
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

test.describe("My Computers", () => {
  test("sidebar has no Computers section; All Files remains the file home", async ({ page }) => {
    await page.goto("/dashboard")
    await expect(page.getByTestId("nav-my-computers")).toHaveCount(0)
    await expect(page.getByRole("link", { name: "My Computers" })).toHaveCount(0)
    await expect(page.getByRole("navigation").getByText("Computers", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "All Files" })).toBeVisible()
  })

  test("empty computer route still explains Desktop backup", async ({ page }) => {
    const existing = await page.request.get("/api/settings/devices")
    if (existing.ok()) {
      const snapshot = (await existing.json()) as { data: { devices: { id: string }[] } }
      for (const device of snapshot.data.devices) {
        await page.request.post(`/api/settings/devices/${device.id}/revoke`)
      }
    }

    await page.goto("/computers")
    await expect(page).toHaveURL(/\/computers/)
    await expect(page.getByRole("heading", { name: "My Computers" })).toBeVisible()
    const empty = page.getByTestId("computers-empty-state")
    await expect(empty).toBeVisible()
    await expect(empty.getByText("No protected computers yet")).toBeVisible()
    await expect(
      empty.getByText("Protect Desktop, Documents, Pictures and other important folders with Arciin Desktop."),
    ).toBeVisible()
    await expect(page.getByRole("button", { name: "Set up computer backup" })).toBeVisible()
    await expect(empty.getByTestId("computer-backup-hint")).toHaveText("Open Arciin Desktop to protect folders.")
    await expect(empty.getByText("Open Arciin Desktop")).toBeVisible()
  })

  test("Set up computer backup falls back to Devices settings in a browser", async ({ page }) => {
    const existing = await page.request.get("/api/settings/devices")
    if (existing.ok()) {
      const snapshot = (await existing.json()) as { data: { devices: { id: string }[] } }
      for (const device of snapshot.data.devices) {
        await page.request.post(`/api/settings/devices/${device.id}/revoke`)
      }
    }

    await page.goto("/computers")
    await expect(page.getByTestId("setup-computer-backup")).toBeVisible()
    await page.getByTestId("setup-computer-backup").click()
    await expect(page).toHaveURL(/\/settings\?tab=devices/)
    await expect(page.getByRole("button", { name: "Generate Pairing Code" })).toBeVisible()
  })

  test("Set up computer backup uses the native sentinel inside Arciin Desktop", async ({
    page,
  }) => {
    const existing = await page.request.get("/api/settings/devices")
    if (existing.ok()) {
      const snapshot = (await existing.json()) as { data: { devices: { id: string }[] } }
      for (const device of snapshot.data.devices) {
        await page.request.post(`/api/settings/devices/${device.id}/revoke`)
      }
    }

    await page.addInitScript(() => {
      Object.defineProperty(window, "chrome", {
        configurable: true,
        value: { webview: {} },
      })
    })
    await page.goto("/computers")
    await expect(page.getByTestId("setup-computer-backup")).toBeVisible()
    await expect(page.getByTestId("computer-backup-hint")).toHaveText(
      "Choose which folders to protect from this PC.",
    )
    await expect(page.getByTestId("computers-empty-state").getByText("Open Arciin Desktop")).toHaveCount(0)
    await page.getByTestId("setup-computer-backup").click()
    await expect(page).toHaveURL(/\/computers/)
    const intent = await page.evaluate(
      () => (window as Window & { __arciinNativeBackupSetupIntent?: string }).__arciinNativeBackupSetupIntent,
    )
    expect(intent).toBe("arciin-native://backup/setup")
    expect(intent).not.toMatch(/credential|cookie|token|password|[?#@]/)
  })

  test("MEMBER can open My Computers and cannot manage devices", async ({ browser, baseURL }) => {
    const { context, page } = await freshContext(browser, baseURL)
    try {
      const member = roleCreds().member
      await login(page, member.email, member.password)
      await expect(page.getByTestId("nav-my-computers")).toHaveCount(0)
      await page.goto("/computers")
      await expect(page.getByRole("heading", { name: "My Computers" })).toBeVisible()
      const listed = await page.request.get("/api/settings/devices")
      expect(listed.status()).toBe(403)
      const me = await page.request.get("/api/auth/me")
      expect(me.ok()).toBeTruthy()
      const body = (await me.json()) as { data: { session: { pairedDeviceId: string | null } | null } }
      expect(body.data.session?.pairedDeviceId).toBeNull()
      const spoof = await page.request.get("/api/auth/me?pairedDeviceId=spoofed-device")
      expect(spoof.ok()).toBeTruthy()
      const spoofed = (await spoof.json()) as { data: { session: { pairedDeviceId: string | null } | null } }
      expect(spoofed.data.session?.pairedDeviceId).toBeNull()
    } finally {
      await context.close()
    }
  })

  test("paired backup appears as one computer card with preserved hierarchy", async ({
    browser,
    baseURL,
    page,
  }) => {
    test.setTimeout(240_000)
    const desktop = await browser.newContext({ storageState: undefined, baseURL })
    try {
      const existing = await page.request.get("/api/settings/devices")
      if (existing.ok()) {
        const snapshot = (await existing.json()) as { data: { devices: { id: string }[] } }
        for (const device of snapshot.data.devices) {
          await page.request.post(`/api/settings/devices/${device.id}/revoke`)
        }
      }

      await page.goto("/settings?tab=devices")
      await expect(page.getByRole("button", { name: "Generate Pairing Code" })).toBeVisible()
      await page.getByRole("button", { name: "Generate Pairing Code" }).click()
      const codePanel = page.getByTestId("device-pairing-code")
      const display = await codePanel.locator("p.font-mono").first().textContent()
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
      const paired = (await pair.json()) as { data: { device: { id: string } } }

      const enabled = await page.request.post("/api/backup/profiles", {
        data: {
          deviceId: paired.data.device.id,
          roots: [{ kind: "DESKTOP", displayName: "Desktop", sourcePathIdentifier: "desktop-root" }],
        },
      })
      expect(enabled.ok()).toBeTruthy()
      const backup = (await enabled.json()) as {
        data: {
          credential: string
          profile: { roots: Array<{ id: string; folderId: string }> }
        }
      }

      const folder = await desktop.request.post("/api/backup/folders", {
        headers: { Authorization: `ArciinSync ${backup.data.credential}` },
        data: {
          syncRootId: backup.data.profile.roots[0]!.id,
          clientEntryId: "folder-webproject",
          relativePath: "WebProject",
          operationId: "e2e-folder-webproject",
        },
      })
      expect(folder.ok()).toBeTruthy()

      const nested = await desktop.request.post("/api/backup/folders", {
        headers: { Authorization: `ArciinSync ${backup.data.credential}` },
        data: {
          syncRootId: backup.data.profile.roots[0]!.id,
          clientEntryId: "folder-public",
          relativePath: "WebProject/public",
          operationId: "e2e-folder-public",
        },
      })
      expect(nested.ok()).toBeTruthy()

      async function upload(relativePath: string, clientEntryId: string, file: {
        name: string
        mimeType: string
        buffer: Buffer
      }) {
        const res = await desktop.request.post("/api/backup/files", {
          headers: { Authorization: `ArciinSync ${backup.data.credential}` },
          multipart: {
            syncRootId: backup.data.profile.roots[0]!.id,
            clientEntryId,
            relativePath,
            operationId: `e2e-${clientEntryId}`,
            file,
          },
        })
        expect(res.ok(), `${relativePath} ${res.status()} ${await res.text()}`).toBeTruthy()
      }

      await upload("photo.jpg", "photo", {
        name: "photo.jpg",
        mimeType: "image/png",
        buffer: readFileSync(IMAGE_FIXTURE),
      })
      await upload("invoice.pdf", "invoice", {
        name: "invoice.pdf",
        mimeType: "application/pdf",
        buffer: readFileSync(PDF_FIXTURE),
      })
      await upload("video.mp4", "video", {
        name: "video.mp4",
        mimeType: "video/mp4",
        buffer: readFileSync(VIDEO_FIXTURE),
      })
      await upload("WebProject/package.json", "pkg", {
        name: "package.json",
        mimeType: "application/json",
        buffer: Buffer.from('{"name":"webproject"}'),
      })
      await upload("WebProject/public/logo.png", "logo", {
        name: "logo.png",
        mimeType: "image/png",
        buffer: readFileSync(IMAGE_FIXTURE),
      })
      await upload("WebProject/demo.mp4", "demo", {
        name: "demo.mp4",
        mimeType: "video/mp4",
        buffer: readFileSync(VIDEO_FIXTURE),
      })

      await page.goto("/computers")
      await expect(page.getByTestId("computer-card")).toHaveCount(1)
      await expect(page.getByTestId("setup-computer-backup")).toHaveCount(0)
      await expect(page.getByRole("heading", { name: "Robera Desktop" })).toBeVisible()
      await expect(page.getByText("Desktop", { exact: true }).first()).toBeVisible()
      await page.getByRole("link", { name: "Open Files" }).click()
      await expect(page.getByRole("heading", { name: "Robera Desktop" })).toBeVisible()
      await page.locator('a[href*="folder="]').filter({ hasText: "Desktop" }).click()
      await expect(page.getByRole("link", { name: "WebProject" })).toBeVisible()
      await expect(page.getByTitle("photo.jpg", { exact: true })).toBeVisible()
      await page.getByRole("link", { name: "WebProject" }).click()
      await expect(page.getByRole("link", { name: "public" })).toBeVisible()
      await expect(page.getByTitle("package.json", { exact: true })).toBeVisible()
      await expect(page.getByTitle("demo.mp4", { exact: true })).toBeVisible()

      await page.goto("/files")
      await expect(page.getByTestId("source-filter")).toBeVisible()
      await page.getByTestId("source-filter").click()
      const sourceMenu = page.getByRole("listbox", { name: "Source filter" })
      await expect(sourceMenu.getByRole("option", { name: "All sources", exact: true })).toBeVisible()
      await expect(sourceMenu.getByRole("option", { name: "Manual uploads", exact: true })).toBeVisible()
      await expect(sourceMenu.getByRole("option", { name: "Computer backups", exact: true })).toBeVisible()
      await expect(sourceMenu.getByRole("option", { name: "Robera Desktop", exact: true })).toHaveCount(1)
      await sourceMenu.getByRole("option", { name: "Computer backups", exact: true }).click()
      await expect(page.getByTitle("photo.jpg", { exact: true }).first()).toBeVisible()
      await expect(page.getByTestId("browse-computer")).toHaveCount(0)
      await page.getByTestId("source-filter").click()
      await sourceMenu.getByRole("option", { name: "Robera Desktop", exact: true }).click()
      await expect(page.getByTestId("browse-computer")).toBeVisible()
      await expect(page.getByTitle("photo.jpg", { exact: true })).toHaveCount(1)
      await page.getByRole("toolbar", { name: "Search, filter, and view assets" }).getByRole("button", { name: "Images", exact: true }).click()
      await expect(page.getByTitle("photo.jpg", { exact: true })).toHaveCount(1)
      await expect(page.getByTitle("logo.png", { exact: true })).toHaveCount(1)
      await expect(page.getByTitle("invoice.pdf", { exact: true })).toHaveCount(0)
      await page.getByTestId("browse-computer").click()
      await expect(page).toHaveURL(/\/computers\//)
      await expect(page.getByRole("heading", { name: "Robera Desktop" })).toBeVisible()

      await page.goto("/images")
      await expect(page.getByText("logo.png").first()).toBeVisible()
      await expect(page.getByText(/Robera Desktop › Desktop › WebProject/).first()).toBeVisible()

      await page.goto("/videos")
      await expect(page.getByText("demo.mp4").first()).toBeVisible()

      await page.goto("/settings?tab=devices")
      await expect(page.getByTestId("device-backup-summary")).toBeVisible()
      await expect(page.getByTestId("manage-backup-remote")).toBeVisible()
      await expect(page.getByRole("link", { name: "Manage Backup" })).toBeVisible()
      await expect(page.getByTestId("turn-on-backup")).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Disable Backup" })).toBeVisible()
      await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Revoke access" })).toBeVisible()

      await page.getByRole("button", { name: "Disable Backup" }).click()
      await page.getByRole("button", { name: "Disable Backup" }).last().click()
      await expect(page.getByText(/Not enabled/)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole("button", { name: "Disable Backup" })).toHaveCount(0)

      await page.getByRole("button", { name: "Revoke access" }).click()
      await page.getByRole("button", { name: "Revoke Access" }).click()
      await expect(page.getByText("No trusted devices yet.")).toBeVisible({ timeout: 30_000 })
    } finally {
      await desktop.close()
    }
  })
})
