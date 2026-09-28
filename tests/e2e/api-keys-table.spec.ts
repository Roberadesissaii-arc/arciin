import { expect, test, type Page } from "@playwright/test"

/**
 * The API key table, as rendered. The list is served from fixtures so every
 * state is present — including a key with no expiry and no rate limit, which
 * new keys can no longer be created as — and nothing on the instance changes.
 */

const DAY = 86_400_000
const keys = [
  {
    id: "key-limited",
    name: "pax-sec-limited",
    keyPrefix: "arc_36c76a3c",
    scopes: ["libraries:read"],
    lastUsedAt: new Date(Date.now() - 3 * DAY).toISOString(),
    expiresAt: new Date(Date.now() + 91 * DAY).toISOString(),
    rateLimitPerMinute: 600,
    createdAt: new Date(Date.now() - 10 * DAY).toISOString(),
    revokedAt: null,
  },
  {
    id: "key-legacy",
    name: "legacy-unbounded",
    keyPrefix: "arc_0f1e2d3c",
    scopes: ["assets:read", "uploads:create"],
    lastUsedAt: null,
    expiresAt: null,
    rateLimitPerMinute: null,
    createdAt: new Date(Date.now() - 400 * DAY).toISOString(),
    revokedAt: null,
  },
]

async function openTable(page: Page) {
  await page.route("**/api/api-keys", async (route) => {
    if (route.request().method() !== "GET") return route.continue()
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: keys }) })
  })
  await page.goto("/developer/api-keys")
  await expect(page.getByTestId("api-key-row")).toHaveCount(2, { timeout: 60_000 })
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test("metadata sits in the right columns", async ({ page }) => {
    await openTable(page)
    const [limited, legacy] = [page.getByTestId("api-key-row").nth(0), page.getByTestId("api-key-row").nth(1)]

    await expect(limited.getByTestId("api-key-prefix")).toHaveText(/arc_36c76a3c\s*600 req\/min/)
    await expect(limited.getByTestId("api-key-scopes")).toContainText("libraries:read")
    await expect(limited.getByTestId("api-key-scopes")).toContainText(/Expires in 3 months/)
    await expect(limited.getByTestId("api-key-last-used")).toHaveText("3 days ago", { useInnerText: true })

    await expect(legacy.getByTestId("api-key-prefix")).toContainText("No rate limit")
    const noExpiry = legacy.getByTestId("api-key-scopes").getByText("No expiration")
    await expect(noExpiry).toBeVisible()
    expect(await noExpiry.evaluate((el) => getComputedStyle(el).color)).not.toBe(
      await limited.getByTestId("api-key-scopes").getByText(/Expires/).evaluate((el) => getComputedStyle(el).color),
    )
    await expect(legacy.getByTestId("api-key-last-used")).toHaveText("Never", { useInnerText: true })

    // The mobile-only labels stay out of the desktop table.
    await expect(limited.getByTestId("api-key-mobile-rate")).toBeHidden()
  })

  test("Rotate is solid neutral, Revoke solid red, both the same size", async ({ page }) => {
    await openTable(page)
    const row = page.getByTestId("api-key-row").first()
    // Colours are read back as pixels: Tailwind 4 reports oklch(), which this compares as RGB.
    const style = (testId: string) =>
      row.getByTestId(testId).evaluate((el) => {
        const s = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        const px = (css: string) => {
          const c = document.createElement("canvas")
          c.width = c.height = 1
          const ctx = c.getContext("2d")!
          ctx.fillStyle = css
          ctx.fillRect(0, 0, 1, 1)
          const [red, green, blue, alpha] = ctx.getImageData(0, 0, 1, 1).data
          return `rgba(${red}, ${green}, ${blue}, ${alpha! / 255})`
        }
        return { bg: px(s.backgroundColor), color: px(s.color), width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top) }
      })
    const rotate = await style("api-key-rotate")
    const revoke = await style("api-key-revoke")

    const rgb = (value: string) => value.match(/\d+(\.\d+)?/g)!.map(Number)
    const [rr, rg, rb, ra = 1] = rgb(rotate.bg)
    expect(ra, "Rotate has a solid background").toBe(1)
    expect(Math.max(rr!, rg!, rb!), "Rotate is dark").toBeLessThan(60)
    expect(Math.max(rr!, rg!, rb!) - Math.min(rr!, rg!, rb!), "Rotate is neutral, not a hue").toBeLessThan(12)
    expect(rgb(rotate.color).slice(0, 3)).toEqual([255, 255, 255])

    const [vr, vg, vb, va = 1] = rgb(revoke.bg)
    expect(va).toBe(1)
    expect(vr!, "Revoke is red").toBeGreaterThan(180)
    expect(vg!).toBeLessThan(80)
    expect(vb!).toBeLessThan(80)

    expect(rotate.height).toBe(revoke.height)
    expect(Math.abs(rotate.width - revoke.width)).toBeLessThanOrEqual(1)
    expect(rotate.top).toBe(revoke.top)
  })
})

// Phones get the "built for desktop" screen; the table's narrow layout is for tablets.
test.describe("tablet (no column headings)", () => {
  test.use({ viewport: { width: 820, height: 1180 } })

  test("each value says what it is when the headings are hidden", async ({ page }) => {
    await openTable(page)
    const [limited, legacy] = [page.getByTestId("api-key-row").nth(0), page.getByTestId("api-key-row").nth(1)]
    await expect(limited.getByTestId("api-key-mobile-rate")).toHaveText("Rate limit · 600 req/min")
    await expect(legacy.getByTestId("api-key-mobile-rate")).toHaveText("Rate limit · No rate limit")
    await expect(limited.getByTestId("api-key-scopes")).toContainText(/Expires in 3 months/)
    await expect(legacy.getByTestId("api-key-scopes")).toContainText("No expiration")
    await expect(limited.getByTestId("api-key-last-used")).toHaveText("Last used · 3 days ago", { useInnerText: true })
    await expect(legacy.getByTestId("api-key-last-used")).toHaveText("Last used · Never", { useInnerText: true })
    await expect(limited.getByTestId("api-key-rotate")).toBeVisible()
    await expect(limited.getByTestId("api-key-revoke")).toBeVisible()
    // No sideways scrolling.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
})
