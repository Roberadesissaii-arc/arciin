import { expect, test } from "@playwright/test"

/**
 * Settings → Domain must not present a Docker/container bridge as LAN.
 */

test("Settings Domain does not advertise a Docker bridge as LAN", async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto("/settings?tab=domain")
  await expect(page.getByRole("heading", { name: "Addresses" })).toBeVisible({
    timeout: 30_000,
  })

  const addresses = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Addresses" }),
  })

  const lanChips = addresses.locator("div.rounded-lg.border").filter({ hasText: /^LAN/ })
  const lanCount = await lanChips.count()
  for (let i = 0; i < lanCount; i += 1) {
    const text = await lanChips.nth(i).innerText()
    expect(text, "LAN chips must not use the Docker default bridge").not.toMatch(/172\.17\./)
  }

  await expect(addresses.getByText("This machine", { exact: true })).toBeVisible()
  await expect(addresses.getByText(/127\.0\.0\.1/).first()).toBeVisible()
})
