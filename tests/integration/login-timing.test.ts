import { describe, expect, it } from "vitest"

import { hashPassword, verifyLoginPassword } from "../../apps/api/src/services/security/auth"

/**
 * An unknown email must cost about as much to reject as a wrong password.
 *
 * Found in the v1.1.0 pentest: identical 401 bodies, but ~4 ms for an unknown
 * address vs ~90 ms for a real one — a timing oracle for which emails have
 * accounts. The bound is deliberately generous (30%) so a loaded runner does
 * not make this flaky; before the fix the ratio was ~5%.
 */
async function avgMs(fn: () => Promise<unknown>, n = 4) {
  await fn() // warm-up
  const t0 = performance.now()
  for (let i = 0; i < n; i++) await fn()
  return (performance.now() - t0) / n
}

describe("login password verification timing", () => {
  it("rejects a missing account with comparable work to a wrong password", async () => {
    const real = await hashPassword("correct horse battery staple")
    const known = await avgMs(() => verifyLoginPassword("wrong", real))
    const unknown = await avgMs(() => verifyLoginPassword("wrong", null))
    expect(unknown).toBeGreaterThan(known * 0.3)
  })

  it("still never accepts a missing account", async () => {
    expect(await verifyLoginPassword("anything", null)).toBe(false)
    expect(await verifyLoginPassword("anything", undefined)).toBe(false)
  })

  it("still accepts the right password for a real account", async () => {
    const real = await hashPassword("pw-123456")
    expect(await verifyLoginPassword("pw-123456", real)).toBe(true)
  })
})
