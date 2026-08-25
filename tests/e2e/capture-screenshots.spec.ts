import { test, expect, type Page } from "@playwright/test"
import path from "node:path"

/**
 * Capture the screenshots the README ships.
 *
 * Not a test — an artefact generator, kept in the browser suite because that is
 * where a signed-in, seeded instance already exists. Run it deliberately:
 *
 *   npx playwright test capture-screenshots --workers=1
 *
 * It is skipped in normal runs so a documentation refresh never gates a release.
 */

const OUT = path.resolve(__dirname, "../../docs/screenshots")
const CAPTURE = process.env.CAPTURE_SCREENSHOTS === "1"

test.skip(!CAPTURE, "set CAPTURE_SCREENSHOTS=1 to regenerate README images")

test.use({ viewport: { width: 1600, height: 1000 } })

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {})
  // Let entrance animations finish so the capture is not a half-faded frame.
  await page.waitForTimeout(1200)
}

const shots: Array<{ name: string; path: string; wait?: string }> = [
  { name: "dashboard", path: "/dashboard" },
  { name: "files", path: "/files" },
  { name: "videos", path: "/videos" },
  { name: "chat", path: "/chat" },
  { name: "settings", path: "/settings" },
]

for (const shot of shots) {
  test(`capture ${shot.name}`, async ({ page }) => {
    await page.goto(shot.path, { waitUntil: "domcontentloaded" })
    await settle(page)
    await expect(page.locator("body")).toBeVisible()
    await page.screenshot({ path: path.join(OUT, `${shot.name}.png`), fullPage: false })
  })
}
