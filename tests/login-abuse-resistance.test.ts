import { describe, expect, it } from "vitest"

import {
  MAX_BACKOFF_MS,
  accountKey,
  backoffMs,
  failKey,
} from "../apps/api/src/services/security/login-abuse"

/**
 * An unauthenticated stranger who knew the owner's email address could switch
 * the instance off.
 *
 * The lock was counted on the email alone. Ten wrong passwords inside the
 * fifteen-minute window denied every later attempt for that address —
 * including the correct password from the owner's own machine — and the
 * per-IP ceiling of twenty a minute left an attacker ample room to keep the
 * counter topped up indefinitely.
 *
 * The lock is now counted per client per account, so it falls on whoever is
 * failing. A separate account-wide counter still exists, but it only decides
 * how long a failed attempt waits; it never refuses one.
 */

describe("a lock belongs to the client that earned it", () => {
  it("separates two clients attacking the same account", () => {
    expect(failKey("owner@example.com", "203.0.113.9")).not.toBe(
      failKey("owner@example.com", "198.51.100.4"),
    )
  })

  it("separates two accounts from the same client", () => {
    expect(failKey("a@example.com", "203.0.113.9")).not.toBe(
      failKey("b@example.com", "203.0.113.9"),
    )
  })

  it("treats an address case-insensitively, as login does", () => {
    expect(failKey("Owner@Example.COM", "203.0.113.9")).toBe(
      failKey("owner@example.com", "203.0.113.9"),
    )
  })

  it("keeps the account-wide counter distinct from any client's lock", () => {
    // If these collided, the account counter would lock people out, which is
    // the behaviour being removed.
    expect(accountKey("owner@example.com")).not.toBe(
      failKey("owner@example.com", "203.0.113.9"),
    )
  })

  it("the owner's key is untouched by an attacker's failures", () => {
    const attacker = failKey("owner@example.com", "203.0.113.9")
    const owner = failKey("owner@example.com", "192.168.4.30")
    // Nothing an attacker increments can reach the owner's counter, so a
    // correct password from the owner's address is never refused by the lock.
    expect(attacker).not.toBe(owner)
  })
})

describe("spread-out guessing gets slower without anyone being refused", () => {
  it("costs nothing on a first failure", () => {
    expect(backoffMs(1)).toBe(0)
  })

  it("grows with the number of failures against the account", () => {
    expect(backoffMs(2)).toBeGreaterThan(backoffMs(1))
    expect(backoffMs(5)).toBeGreaterThan(backoffMs(3))
  })

  it("is capped, so a legitimate attempt never hangs", () => {
    for (const n of [10, 50, 1000]) {
      expect(backoffMs(n)).toBeLessThanOrEqual(MAX_BACKOFF_MS)
    }
  })

  it("is a delay, not a denial — every count still returns a number", () => {
    for (const n of [1, 2, 20, 500]) {
      expect(Number.isFinite(backoffMs(n))).toBe(true)
    }
  })
})

describe("the denial does not describe the account", () => {
  it("names the device, not the account state", async () => {
    // "ACCOUNT_LOCKED" told an attacker their denial-of-service had landed,
    // and told anyone that the address existed. The limit is on the
    // requester, so the message says so.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("apps/api/src/services/security/login-guard.ts", "utf8"),
    )
    expect(source).toContain("TOO_MANY_ATTEMPTS")
    expect(source).not.toContain("ACCOUNT_LOCKED")
  })
})
