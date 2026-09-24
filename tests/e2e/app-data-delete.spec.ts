import { expect, test, type Page } from "@playwright/test"

/**
 * App Data delete buttons for databases, tables, and rows.
 *
 * They were reported as doing nothing. The API was fine; every button was
 * gated on window.confirm(), which returns false without showing anything in
 * the desktop client's WebView and in any tab that has suppressed dialogs.
 * They now open an in-page destructive dialog, so this spec also fails if a
 * native dialog ever appears again.
 */

function forbidNativeDialogs(page: Page) {
  page.on("dialog", async (dialog) => {
    await dialog.dismiss()
    throw new Error(`native ${dialog.type()} dialog appeared: ${dialog.message()}`)
  })
}

async function seed(request: import("@playwright/test").APIRequestContext) {
  const db = await request.post("/api/app-databases", { data: { name: `Delete spec ${Date.now()}` } })
  expect(db.status()).toBe(201)
  const database = (await db.json()).data
  const tbl = await request.post(`/api/app-databases/${database.id}/tables`, { data: { name: "items" } })
  expect(tbl.status()).toBe(201)
  const table = (await tbl.json()).data
  const row = await request.post(`/api/app-database-tables/${table.id}/rows`, {
    data: { name: "margherita", payload: { price: 12.99 } },
  })
  expect(row.status()).toBe(201)
  return { database, table, row: (await row.json()).data }
}

test("row and table delete with the mouse; database delete with the keyboard", async ({ page, request }) => {
  forbidNativeDialogs(page)
  const { database, table, row } = await seed(request)

  await page.goto(`/database/app-data/${database.id}`)
  await expect(page.getByText("items").first()).toBeVisible({ timeout: 60_000 })

  // Open the table so its rows render.
  const tableRow = page.getByRole("row").filter({ hasText: "items" }).first()
  await tableRow.getByRole("button", { name: /^open$/i }).click()
  await expect(page.getByText("margherita").first()).toBeVisible({ timeout: 15_000 })

  // Row: mouse. Cancel first — nothing must be deleted.
  await page.getByRole("button", { name: "Delete row margherita" }).click()
  await page.getByRole("button", { name: "Cancel" }).click()
  expect((await request.get(`/api/app-database-tables/${table.id}/rows`)).status()).toBe(200)
  expect(((await (await request.get(`/api/app-database-tables/${table.id}/rows`)).json()).data as unknown[]).length).toBe(1)

  await page.getByRole("button", { name: "Delete row margherita" }).click()
  await page.getByTestId("app-row-delete-confirm").click()
  await expect
    .poll(async () => ((await (await request.get(`/api/app-database-tables/${table.id}/rows`)).json()).data as unknown[]).length)
    .toBe(0)
  void row

  // Table: mouse.
  await page.getByRole("button", { name: "Delete table items" }).click()
  await page.getByTestId("app-table-delete-confirm").click()
  // Every database keeps its auto-created Default table; "items" is the one that must go.
  await expect
    .poll(async () =>
      ((await (await request.get(`/api/app-databases/${database.id}/tables`)).json()).data as Array<{ id: string }>).some(
        (t) => t.id === table.id,
      ),
    )
    .toBe(false)

  // Database: keyboard only, from the list.
  await page.goto("/database/app-data")
  const del = page.getByRole("button", { name: `Delete database ${database.name}` })
  await expect(del).toBeVisible({ timeout: 30_000 })
  await del.focus()
  await page.keyboard.press("Enter")
  const confirm = page.getByTestId("app-database-delete-confirm")
  await expect(confirm).toBeVisible()
  // Focus lands inside the dialog; Tab to the destructive action and press it.
  await confirm.focus()
  await page.keyboard.press("Enter")
  await expect.poll(async () => (await request.get(`/api/app-databases/${database.id}`)).status()).toBe(404)
  await expect(del).toBeHidden({ timeout: 15_000 })
})

test("Escape cancels a delete", async ({ page, request }) => {
  forbidNativeDialogs(page)
  const { database } = await seed(request)
  await page.goto("/database/app-data")
  const del = page.getByRole("button", { name: `Delete database ${database.name}` })
  await expect(del).toBeVisible({ timeout: 30_000 })
  await del.click()
  await expect(page.getByTestId("app-database-delete-confirm")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("app-database-delete-confirm")).toBeHidden()
  expect((await request.get(`/api/app-databases/${database.id}`)).status()).toBe(200)
  // Clean up through the API.
  expect((await request.delete(`/api/app-databases/${database.id}`)).status()).toBe(200)
})
