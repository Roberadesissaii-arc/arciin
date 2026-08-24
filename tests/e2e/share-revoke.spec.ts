import { expect, test } from "@playwright/test"

/**
 * FIX-025 — a share link you cannot take back is not a share, it is a leak.
 *
 * The dialog said "You can revoke links anytime from Activity". Activity had
 * no such control, and nothing in the app called `revokeShareLink`, so a
 * public anonymous link to a private file — created without an expiry — was
 * permanent. The server route worked the whole time.
 */
test("a share link can be listed and revoked from the share dialog", async ({ page, request }) => {
  // Arrange a link through the API, so the test is about revoking, not creating.
  const assets = await (await request.get("/api/assets")).json()
  const asset = assets.data?.[0]
  test.skip(!asset, "needs at least one asset in the library")

  const created = await request.post("/api/shares", {
    data: { resourceType: "ASSET", assetId: asset.id, name: "revoke-spec" },
  })
  expect(created.ok()).toBe(true)
  const share = (await created.json()).data
  const token: string = share.rawToken

  // The link works before revocation.
  expect((await request.get(`/api/shares/access/${token}`)).status()).toBe(200)

  await page.goto("/files")
  const card = page.locator(`[data-asset-id="${asset.id}"]`)
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click({ button: "right" })
  await page.getByTestId("asset-menu-share").click()

  const row = page.getByRole("listitem").filter({ hasText: share.tokenPrefix })
  await expect(row, "the existing link must be listed").toBeVisible({ timeout: 15_000 })

  await row.getByRole("button", { name: /revoke/i }).click()
  await row.getByRole("button", { name: /^revoke$/i }).click()

  await expect(row).toBeHidden({ timeout: 15_000 })

  // And the link is genuinely dead, not just hidden.
  await expect
    .poll(async () => (await request.get(`/api/shares/access/${token}`)).status(), {
      timeout: 15_000,
    })
    .toBe(404)
})

test("the dialog no longer sends people to Activity to revoke", async ({ page }) => {
  await page.goto("/files")
  const card = page.locator("[data-asset-id]").first()
  await expect(card).toBeVisible({ timeout: 60_000 })
  await card.click({ button: "right" })
  await page.getByTestId("asset-menu-share").click()

  await expect(page.getByText(/revoke links anytime from Activity/i)).toHaveCount(0)
  await expect(page.getByText(/Existing links/i)).toBeVisible({ timeout: 10_000 })
})
