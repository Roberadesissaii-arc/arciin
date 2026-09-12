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

  // When the configured public URL has no explicit port (Docker/Caddy :80),
  // Settings must not invent the Next.js listen port.
  try {
    const configured = process.env.ARCIIN_PUBLIC_URL
    if (configured) {
      const parsed = new URL(configured)
      if (!parsed.port) {
        const text = await addresses.innerText()
        expect(text, "Docker/Caddy default must not advertise :3000").not.toMatch(/:3000\b/)
      }
    }
  } catch {
    /* ignore unparseable test public URL */
  }
})
