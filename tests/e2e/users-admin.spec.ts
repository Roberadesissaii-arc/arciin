import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

import { expect, test, type Browser, type Page } from "@playwright/test"

import { newUnauthedContext } from "./desktop-promo"

const OWNER_EMAIL = "e2e@arciin.invalid"
const PASSWORD_FILE = "/tmp/arciin-e2e-pw"
const ROLE_FILE = "/tmp/arciin-e2e-role-users.json"

type RoleCreds = {
  admin: { email: string; password: string }
  member: { email: string; password: string }
  viewer: { email: string; password: string }
}

function ownerPassword() {
  return readFileSync(PASSWORD_FILE, "utf8").trim()
}

function roleCreds(): RoleCreds {
  return JSON.parse(readFileSync(ROLE_FILE, "utf8")) as RoleCreds
}

function setE2EPlan(plan: "free" | "team") {
  execFileSync(process.execPath, [path.resolve("scripts/e2e-seed.mjs"), `--set-plan=${plan}`], {
    stdio: "inherit",
  })
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
  const consoleErrors: string[] = []
  const failedRequests: string[] = []
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })
  page.on("requestfailed", (req) => {
    failedRequests.push(`${req.method()} ${req.url()} ${req.failure()?.errorText ?? ""}`)
  })
  return { context, page, consoleErrors, failedRequests }
}

function userRow(page: Page, email: string) {
  return page.locator("div.rounded-xl.border").filter({ has: page.getByText(email, { exact: true }) })
}

test.describe.configure({ mode: "serial" })

test.describe("Settings → Users administration", () => {
  test.setTimeout(240_000)

  test("OWNER can create, change role, disable, and remove a user", async ({
    browser,
    baseURL,
  }) => {
    const stamp = Date.now()
    const memberEmail = `wave2-member-${stamp}@example.invalid`
    const createdPassword = "Wave2MemberPass!"
    const { context: ownerCtx, page, consoleErrors } = await freshContext(browser, baseURL)
    const { context: disabledCtx, page: disabledPage } = await freshContext(browser, baseURL)

    try {
      setE2EPlan("team")
      await login(page, OWNER_EMAIL, ownerPassword())
      await page.goto("/settings/users")
      await expect(page.getByRole("heading", { name: "Users" })).toBeVisible({ timeout: 30_000 })
      await expect(page.locator("#dashboard-scaled-content").getByText(OWNER_EMAIL).first()).toBeVisible()

      await page.locator("#user-name").fill("Wave2 Member")
      await page.locator("#user-email").fill(memberEmail)
      await page.locator("#user-password").fill(createdPassword)
      const created = page.waitForResponse(
        (res) => res.url().includes("/settings/users") && res.request().method() === "POST",
      )
      await page.getByRole("button", { name: "Create user" }).click({ force: true })
      const createdRes = await created
      expect(createdRes.status(), await createdRes.text()).toBe(201)
      await expect(page.getByText(memberEmail)).toBeVisible({ timeout: 15_000 })

      const row = userRow(page, memberEmail)
      await row.getByRole("combobox", { name: `Role for ${memberEmail}` }).click()
      await page.getByRole("option", { name: "Viewer" }).click()
      await expect(row.getByText("VIEWER", { exact: true })).toBeVisible({ timeout: 15_000 })

      // In-page confirmation (window.confirm was silently false in WebViews).
      await row.getByRole("button", { name: "Disable" }).click()
      await page.getByRole("alertdialog").getByRole("button", { name: "Disable account" }).click()
      await expect(row.getByText("DISABLED", { exact: true })).toBeVisible({ timeout: 15_000 })

      await disabledPage.goto("/login")
      await disabledPage.locator('input[type="email"]').fill(memberEmail)
      await disabledPage.locator('input[type="password"]').first().fill(createdPassword)
      await disabledPage.getByRole("button", { name: /sign in|log in|continue/i }).first().click()
      await expect(disabledPage.getByRole("alert").filter({ hasText: /email or password is incorrect/i })).toBeVisible({
        timeout: 15_000,
      })
      expect(disabledPage.url()).toContain("/login")

      await row.getByRole("button", { name: "Enable" }).click()
      await expect(row.getByText("ACTIVE", { exact: true })).toBeVisible({ timeout: 15_000 })

      const { context: reenabledCtx, page: reenabledPage } = await freshContext(browser, baseURL)
      try {
        await login(reenabledPage, memberEmail, createdPassword)
        expect(reenabledPage.url()).not.toContain("/login")
      } finally {
        await reenabledCtx.close()
      }

      await row.getByRole("combobox", { name: `Role for ${memberEmail}` }).click()
      await page.getByRole("option", { name: "Member" }).click()
      await expect(row.getByText("MEMBER", { exact: true })).toBeVisible({ timeout: 15_000 })

      await row.getByRole("button", { name: "Remove" }).click()
      await page.getByRole("alertdialog").getByRole("button", { name: "Remove account" }).click()
      await expect(page.getByText(memberEmail)).toHaveCount(0, { timeout: 15_000 })

      const featureErrors = consoleErrors.filter(
        (text) =>
          !/favicon|Download the React DevTools|401 \(Unauthorized\)/i.test(text),
      )
      expect(featureErrors, featureErrors.join("\n")).toEqual([])
    } finally {
      await disabledCtx.close()
      await ownerCtx.close()
    }
  })

  test("stale MEMBER session dies after OWNER disable and role change", async ({
    browser,
    baseURL,
  }) => {
    const creds = roleCreds()
    const { context: ownerCtx, page: ownerPage } = await freshContext(browser, baseURL)
    const { context: memberCtx, page: memberPage } = await freshContext(browser, baseURL)

    try {
      setE2EPlan("team")
      await login(ownerPage, OWNER_EMAIL, ownerPassword())
      await login(memberPage, creds.member.email, creds.member.password)

      const meOk = await memberPage.request.get("/api/auth/me")
      expect(meOk.status()).toBe(200)

      await ownerPage.goto("/settings/users")
      const row = userRow(ownerPage, creds.member.email)
      await row.getByRole("button", { name: "Disable" }).click()
      await ownerPage.getByRole("alertdialog").getByRole("button", { name: "Disable account" }).click()
      await expect(row.getByText("DISABLED", { exact: true })).toBeVisible({ timeout: 15_000 })

      const meDenied = await memberPage.request.get("/api/auth/me")
      expect(meDenied.status()).toBe(401)

      await row.getByRole("button", { name: "Enable" }).click()
      await expect(row.getByText("ACTIVE", { exact: true })).toBeVisible({ timeout: 15_000 })

      const { context: member2Ctx, page: member2Page } = await freshContext(browser, baseURL)
      try {
        await login(member2Page, creds.member.email, creds.member.password)
        const beforeRole = await member2Page.request.get("/api/auth/me")
        expect(beforeRole.status()).toBe(200)

        await row.getByRole("combobox", { name: `Role for ${creds.member.email}` }).click()
        await ownerPage.getByRole("option", { name: "Viewer" }).click()
        await expect(row.getByText("VIEWER", { exact: true })).toBeVisible({ timeout: 15_000 })

        const afterRole = await member2Page.request.get("/api/auth/me")
        expect(afterRole.status()).toBe(401)
      } finally {
        await member2Ctx.close()
        await row.getByRole("combobox", { name: `Role for ${creds.member.email}` }).click()
        await ownerPage.getByRole("option", { name: "Member" }).click()
        await expect(row.getByText("MEMBER", { exact: true })).toBeVisible({ timeout: 15_000 })
      }
    } finally {
      await memberCtx.close()
      await ownerCtx.close()
    }
  })

  test("ADMIN can manage members but not OWNER/ADMIN escalation", async ({ browser, baseURL }) => {
    const creds = roleCreds()
    const { context, page } = await freshContext(browser, baseURL)
    const created = `wave2-admin-created-${Date.now()}@example.invalid`

    try {
      setE2EPlan("team")
      await login(page, creds.admin.email, creds.admin.password)
      await page.goto("/files")
      await expect(page).not.toHaveURL(/\/login/)

      await page.goto("/settings/users")
      await expect(page.getByRole("heading", { name: "Users" })).toBeVisible({ timeout: 30_000 })
      await expect(page.locator("#dashboard-scaled-content").getByText(OWNER_EMAIL).first()).toBeVisible()

      const list = await page.request.get("/api/settings/users")
      expect(list.status()).toBe(200)

      await page.locator("#user-name").fill("Admin Created")
      await page.locator("#user-email").fill(created)
      await page.locator("#user-password").fill("AdminCreated1!")
      await page.getByRole("button", { name: "Create user" }).click({ force: true })
      await expect(page.getByText(created)).toBeVisible({ timeout: 15_000 })

      const ownerCreate = await page.request.post("/api/settings/users", {
        data: {
          name: "Fake Owner",
          email: `fake-owner-${Date.now()}@example.invalid`,
          password: "NotAllowed1!",
          role: "OWNER",
        },
      })
      expect(ownerCreate.status()).toBeGreaterThanOrEqual(400)

      const adminCreate = await page.request.post("/api/settings/users", {
        data: {
          name: "Fake Admin",
          email: `fake-admin-${Date.now()}@example.invalid`,
          password: "NotAllowed1!",
          role: "ADMIN",
        },
      })
      expect(adminCreate.status()).toBe(403)

      const users = (await list.json()) as { data: Array<{ id: string; email: string; role: string }> }
      const owner = users.data.find((u) => u.role === "OWNER")
      expect(owner).toBeTruthy()
      const ownerPatch = await page.request.patch(`/api/settings/users/${owner!.id}`, {
        data: { role: "MEMBER" },
      })
      expect(ownerPatch.status()).toBe(403)
      const ownerDelete = await page.request.delete(`/api/settings/users/${owner!.id}`)
      expect(ownerDelete.status()).toBe(403)

      const me = (await (await page.request.get("/api/auth/me")).json()) as { data: { user: { id: string } } }
      const selfOwner = await page.request.patch(`/api/settings/users/${me.data.user.id}`, {
        data: { role: "OWNER" },
      })
      expect(selfOwner.status()).toBeGreaterThanOrEqual(400)
    } finally {
      await context.close()
    }
  })

  test("MEMBER can use files but cannot administer users", async ({ browser, baseURL }) => {
    const creds = roleCreds()
    const { context, page } = await freshContext(browser, baseURL)
    try {
      setE2EPlan("team")
      await login(page, creds.member.email, creds.member.password)
      await page.goto("/files")
      await expect(page).not.toHaveURL(/\/login/)

      await page.goto("/settings/users")
      await expect(page.getByText(/you do not have permission to manage users/i)).toBeVisible({
        timeout: 30_000,
      })

      const list = await page.request.get("/api/settings/users")
      expect(list.status()).toBe(403)
      const create = await page.request.post("/api/settings/users", {
        data: {
          name: "Nope",
          email: `member-bypass-${Date.now()}@example.invalid`,
          password: "NotAllowed1!",
          role: "VIEWER",
        },
      })
      expect(create.status()).toBe(403)
    } finally {
      await context.close()
    }
  })

  test("VIEWER can read files but cannot administer users", async ({ browser, baseURL }) => {
    const creds = roleCreds()
    const { context, page } = await freshContext(browser, baseURL)
    try {
      setE2EPlan("team")
      await login(page, creds.viewer.email, creds.viewer.password)
      await page.goto("/files")
      await expect(page).not.toHaveURL(/\/login/)

      await page.goto("/settings/users")
      await expect(page.getByText(/you do not have permission to manage users/i)).toBeVisible({
        timeout: 30_000,
      })

      const list = await page.request.get("/api/settings/users")
      expect(list.status()).toBe(403)
      const create = await page.request.post("/api/settings/users", {
        data: {
          name: "Nope",
          email: `viewer-bypass-${Date.now()}@example.invalid`,
          password: "NotAllowed1!",
          role: "MEMBER",
        },
      })
      expect(create.status()).toBe(403)
    } finally {
      await context.close()
    }
  })

  test("Free plan blocks user administration even for OWNER", async ({ browser, baseURL }) => {
    const { context, page } = await freshContext(browser, baseURL)
    try {
      setE2EPlan("free")
      await login(page, OWNER_EMAIL, ownerPassword())
      await page.goto("/settings/users")
      await expect(page.getByRole("heading", { name: /unlock multiple users/i })).toBeVisible({
        timeout: 30_000,
      })

      const list = await page.request.get("/api/settings/users")
      expect(list.status()).toBe(403)
      const body = await list.json()
      expect(body.error?.code).toBe("LICENSE_REQUIRED")
    } finally {
      setE2EPlan("team")
      await context.close()
    }
  })
})
