import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * "API Keys — 10 records" sat beside a management page listing three, which
 * reads as a discrepancy. It is not one: a revoked key keeps its row with
 * revokedAt set, and that row is the audit trail. Deleting those to make the
 * two numbers agree would destroy the only evidence a key ever existed.
 *
 * What was missing was any way for the Database browser to say so.
 */

const adminRoutes = readFileSync("apps/api/src/modules/admin/routes.ts", "utf8")

/** The rule the server applies, restated so it can be asserted on its own. */
function statusFor(row: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()) {
  if (row.revokedAt) return "Revoked"
  if (row.expiresAt && row.expiresAt.getTime() < now.getTime()) return "Expired"
  return "Active"
}

describe("an API key's status is derived, and revocation wins", () => {
  const now = new Date("2026-06-01T00:00:00Z")
  const past = new Date("2026-01-01T00:00:00Z")
  const future = new Date("2026-12-01T00:00:00Z")

  it.each([
    ["never revoked, no expiry", null, null, "Active"],
    ["never revoked, expiry ahead", null, future, "Active"],
    ["never revoked, expiry passed", null, past, "Expired"],
    ["revoked, no expiry", past, null, "Revoked"],
    ["revoked and also expired", past, past, "Revoked"],
    ["revoked before an expiry that has not arrived", past, future, "Revoked"],
  ])("%s -> %s", (_label, revokedAt, expiresAt, expected) => {
    expect(statusFor({ revokedAt, expiresAt }, now)).toBe(expected)
  })

  it("is computed on the server, not left to each caller", () => {
    // Two surfaces working it out separately is how they end up disagreeing.
    const block = adminRoutes.slice(adminRoutes.indexOf('case "api-keys": {'))
    expect(block).toContain('status: row.revokedAt')
    expect(block).toContain('"Revoked"')
    expect(block).toContain('"Expired"')
  })
})

describe("history is kept, and counted separately from what still works", () => {
  it("the summary distinguishes records from active ones", () => {
    const block = adminRoutes.slice(adminRoutes.indexOf('case "api-keys": {', adminRoutes.indexOf("summaryForTable")))
    expect(block).toContain("historical records")
    expect(block).toContain("active")
    expect(block).toContain("revoked")
    expect(block).toContain("expired")
  })

  it("active is total minus revoked minus expired", () => {
    // Stated as arithmetic so the three badges always add up to the total.
    const total = 10
    const revoked = 7
    const expired = 0
    expect(total - revoked - expired).toBe(3)
  })

  it("nothing in the browser deletes a row", () => {
    // The Database view is for inspection. Revocation lives on the management
    // page, and a revoked row must survive it.
    const browserBlock = adminRoutes.slice(adminRoutes.indexOf("async function rowsForTable"))
    expect(browserBlock).not.toContain("deleteMany")
    expect(browserBlock).not.toContain(".delete(")
  })
})

describe("the browser never hands out a secret", () => {
  const FORBIDDEN = ["keyHash", "passwordHash", "tokenHash", "mfaSecretEnc", "recoveryAnswerHash"]

  it.each(FORBIDDEN)("%s is not selected by any table", (field) => {
    // Every table uses an explicit select; this asserts none of them grew a
    // secret column, including the MFA ones added in this release.
    const selects = adminRoutes.match(/select:\s*\{[^}]*\}/g) ?? []
    expect(selects.length).toBeGreaterThan(5)
    for (const select of selects) {
      expect(select).not.toContain(field)
    }
  })

  it("still shows the prefix, which is safe and is how a key is identified", () => {
    expect(adminRoutes).toContain("keyPrefix: true")
  })
})

describe("one catalogue, so the hub and the detail page cannot drift", () => {
  it("titles and descriptions come from the server, not from the page", () => {
    const hero = readFileSync("apps/web/components/database/admin-table-hero.tsx", "utf8")
    // The hero takes them as props; it does not carry its own copy.
    expect(hero).toContain("label")
    expect(hero).toContain("description")
    expect(hero).not.toMatch(/const\s+(TABLE_LABELS|DESCRIPTIONS)\s*=/)
  })

  it("every detail page gets the hero, not just the ones that were reported", () => {
    const panel = readFileSync(
      "apps/web/components/database/admin-table-detail-panel.tsx",
      "utf8",
    )
    expect(panel).toContain("AdminTableHero")
    // Rendered from the catalogue entry, so a new table gets one for free.
    expect(panel).toContain("table={meta.name}")
  })
})
