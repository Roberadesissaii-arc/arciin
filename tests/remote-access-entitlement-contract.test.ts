import { describe, expect, it } from "vitest"

import { LICENSE_PLANS, PLAN_DEFINITIONS, plansWithFeature } from "@arciin/config"

/**
 * The public Remote Access contract, pinned.
 *
 * arciin.com sells this (its pricing table row "Remote access setup helper",
 * pinned by arciin-web tests/pricing-claims.test.ts) and this server enforces
 * it (ops.remote_access_helper). The two repositories share no code, so both
 * pin the same table: if one side moves, its test fails before a Free customer
 * is sold — or refused — something the other side disagrees about.
 *
 * Status handling (active and grace entitled; expired, revoked and tampered
 * tokens not) is exercised against Postgres in
 * tests/integration/remote-access-entitlement.test.ts.
 */
const CONTRACT = { free: false, pro: true, team: true, business: true } as const

describe("public Remote Access entitlement contract", () => {
  it("plan ids are the ones arciin.com issues", () => {
    expect([...LICENSE_PLANS]).toEqual(["free", "pro", "team", "business"])
  })

  it.each(Object.entries(CONTRACT))("%s → %s", (plan, entitled) => {
    const features = PLAN_DEFINITIONS[plan as keyof typeof CONTRACT].features as readonly string[]
    expect(features.includes("ops.remote_access_helper")).toBe(entitled)
  })

  it("the locked card and the 403 name exactly the paid plans", () => {
    expect(plansWithFeature("ops.remote_access_helper")).toEqual(["pro", "team", "business"])
  })
})
