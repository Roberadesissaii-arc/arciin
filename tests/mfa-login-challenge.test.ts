import { describe, expect, it, vi } from "vitest"

import {
  MFA_CHALLENGE_TTL_SECONDS,
  consumeMfaChallenge,
  issueMfaChallenge,
} from "../apps/api/src/services/security/mfa-login-challenge"

/**
 * The gap between "password was right" and "second factor was right".
 *
 * The ticket is worth nothing on its own — presenting it still requires a
 * valid code — but it must not be reusable, portable between addresses, or
 * survive its window, or it becomes a way to sit and guess codes at leisure.
 */

function fakeRedis() {
  const store = new Map<string, string>()
  const ttls = new Map<string, number>()
  return {
    store,
    ttls,
    async set(key: string, value: string, _mode: string, ttl: number) {
      store.set(key, value)
      ttls.set(key, ttl)
      return "OK"
    },
    async get(key: string) {
      return store.get(key) ?? null
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0
    },
  }
}

const fastifyWith = (redis: ReturnType<typeof fakeRedis>) =>
  ({ redis }) as unknown as Parameters<typeof issueMfaChallenge>[0]

const pending = { userId: "user-a", clientIp: "192.168.4.30", rememberMe: false }

describe("a ticket is spent once", () => {
  it("round-trips for the address that earned it", async () => {
    const redis = fakeRedis()
    const f = fastifyWith(redis)
    const { token } = await issueMfaChallenge(f, pending)
    expect(await consumeMfaChallenge(f, token, pending.clientIp)).toMatchObject({
      userId: "user-a",
      rememberMe: false,
    })
  })

  it("cannot be presented twice", async () => {
    const redis = fakeRedis()
    const f = fastifyWith(redis)
    const { token } = await issueMfaChallenge(f, pending)
    expect(await consumeMfaChallenge(f, token, pending.clientIp)).not.toBeNull()
    expect(await consumeMfaChallenge(f, token, pending.clientIp)).toBeNull()
  })

  it("is spent even when the code that follows is wrong", async () => {
    // Deleted before the code is checked, so the ticket is not a seat from
    // which to guess. The cost of being wrong is one more password entry.
    const redis = fakeRedis()
    const f = fastifyWith(redis)
    const { token } = await issueMfaChallenge(f, pending)
    await consumeMfaChallenge(f, token, pending.clientIp)
    expect(redis.store.size).toBe(0)
  })

  it("is not portable to another address", async () => {
    const redis = fakeRedis()
    const f = fastifyWith(redis)
    const { token } = await issueMfaChallenge(f, pending)
    expect(await consumeMfaChallenge(f, token, "203.0.113.7")).toBeNull()
  })

  it("refuses a made-up ticket", async () => {
    const f = fastifyWith(fakeRedis())
    for (const token of ["", "short", "a".repeat(43)]) {
      expect(await consumeMfaChallenge(f, token, pending.clientIp)).toBeNull()
    }
  })
})

describe("a ticket is stored the way a credential should be", () => {
  it("is never written down in the clear", async () => {
    const redis = fakeRedis()
    const f = fastifyWith(redis)
    const { token } = await issueMfaChallenge(f, pending)
    for (const key of redis.store.keys()) {
      expect(key).not.toContain(token)
    }
  })

  it("carries the password nowhere", async () => {
    const redis = fakeRedis()
    const f = fastifyWith(redis)
    await issueMfaChallenge(f, pending)
    const stored = [...redis.store.values()].join()
    expect(stored).not.toMatch(/password/i)
  })

  it("expires without anyone having to clean up", async () => {
    const redis = fakeRedis()
    const f = fastifyWith(redis)
    await issueMfaChallenge(f, pending)
    const ttl = [...redis.ttls.values()][0]
    expect(ttl).toBe(MFA_CHALLENGE_TTL_SECONDS)
    // Long enough to find a phone, short enough not to be worth stealing.
    expect(ttl).toBeGreaterThanOrEqual(60)
    expect(ttl).toBeLessThanOrEqual(600)
  })

  it("issues a different ticket every time", async () => {
    const f = fastifyWith(fakeRedis())
    const a = await issueMfaChallenge(f, pending)
    const b = await issueMfaChallenge(f, pending)
    expect(a.token).not.toBe(b.token)
  })

  it("remembers the remember-me choice across the second step", async () => {
    const redis = fakeRedis()
    const f = fastifyWith(redis)
    const { token } = await issueMfaChallenge(f, { ...pending, rememberMe: true })
    expect(await consumeMfaChallenge(f, token, pending.clientIp)).toMatchObject({
      rememberMe: true,
    })
  })
})
