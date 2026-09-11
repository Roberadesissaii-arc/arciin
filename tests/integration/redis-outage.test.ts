import type { FastifyReply, FastifyRequest } from "fastify"
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  checkAiRateLimit,
  checkEndpointRateLimit,
} from "../../apps/api/src/services/security/endpoint-rate-limit"

/**
 * ARC-002 — a Redis outage must degrade the instance, not freeze it.
 *
 * Every command the API issued while Redis was unreachable waited forever:
 * `maxRetriesPerRequest: null` (a BullMQ requirement, copied onto an ordinary
 * command client) plus ioredis's offline queue meant the promise simply never
 * settled. Thirty consecutive sign-in attempts returned nothing at all, uploads
 * hung, and `/api/health` hung with them.
 *
 * Two properties are pinned here. The clients must carry finite deadlines, and
 * the security controls that depend on them must fail *closed* — an outage that
 * silently removed brute-force protection would be a worse bug than the hang.
 */

type Captured = { status: number | null; body: unknown }

function fakeReply(): FastifyReply & { captured: Captured } {
  const captured: Captured = { status: null, body: null }
  const reply = {
    captured,
    sent: false,
    status(code: number) {
      captured.status = code
      return this
    },
    send(body: unknown) {
      captured.body = body
      ;(this as { sent: boolean }).sent = true
      return this
    },
  }
  return reply as unknown as FastifyReply & { captured: Captured }
}

/** A request whose Redis is either working, failing, or refusing to answer. */
function fakeRequest(mode: "up" | "down", counter = { value: 0 }): FastifyRequest {
  const fail = async () => {
    throw new Error("Command timed out")
  }
  const redis =
    mode === "down"
      ? { incr: fail, expire: fail }
      : {
          incr: async () => {
            counter.value += 1
            return counter.value
          },
          expire: async () => 1,
        }

  return {
    ip: "203.0.113.7",
    headers: {},
    auth: { user: { id: "user-1" } },
    server: { redis },
  } as unknown as FastifyRequest
}

describe("endpoint rate limiting when Redis is unreachable", () => {
  it("refuses the request instead of waiting", async () => {
    const reply = fakeReply()
    const limited = await checkEndpointRateLimit(fakeRequest("down"), reply, {
      key: "login",
      limit: 20,
      windowSec: 60,
    })

    expect(limited).toBe(true)
    expect(reply.captured.status).toBe(503)
  })

  it("fails closed — an unreadable counter must not mean unlimited attempts", async () => {
    const reply = fakeReply()
    const limited = await checkEndpointRateLimit(fakeRequest("down"), reply, {
      key: "login",
      limit: 20,
      windowSec: 60,
    })

    // `true` is what makes the caller return early. Returning false here would
    // hand an attacker unmetered sign-in attempts for the length of the outage.
    expect(limited).toBe(true)
  })

  it("says the service is degraded without describing the internals", async () => {
    const reply = fakeReply()
    await checkEndpointRateLimit(fakeRequest("down"), reply, {
      key: "login",
      limit: 20,
      windowSec: 60,
    })

    const body = JSON.stringify(reply.captured.body)
    expect(reply.captured.body).toMatchObject({
      error: { code: "RATE_LIMIT_UNAVAILABLE" },
    })
    for (const leak of ["redis", "Redis", "6379", "ECONNREFUSED", "timed out", "password"]) {
      expect(body).not.toContain(leak)
    }
  })

  it("applies the same rule to the AI budgets", async () => {
    const reply = fakeReply()
    const limited = await checkAiRateLimit(fakeRequest("down"), reply, {
      key: "chat",
      limit: 10,
      windowSec: 3600,
    })

    expect(limited).toBe(true)
    expect(reply.captured.status).toBe(503)
  })
})

describe("endpoint rate limiting when Redis is healthy", () => {
  it("still allows traffic under the limit", async () => {
    const counter = { value: 0 }
    const reply = fakeReply()
    const limited = await checkEndpointRateLimit(fakeRequest("up", counter), reply, {
      key: "login",
      limit: 5,
      windowSec: 60,
    })

    expect(limited).toBe(false)
    expect(reply.captured.status).toBeNull()
  })

  it("still returns 429 once the limit is passed", async () => {
    const counter = { value: 0 }
    const request = fakeRequest("up", counter)
    let last = fakeReply()

    for (let i = 0; i < 7; i += 1) {
      last = fakeReply()
      await checkEndpointRateLimit(request, last, { key: "login", limit: 5, windowSec: 60 })
    }

    expect(last.captured.status).toBe(429)
    expect(last.captured.body).toMatchObject({ error: { code: "RATE_LIMITED" } })
  })
})

/**
 * The hang was a configuration defect, so the configuration is what has to stay
 * fixed. Asserted against the source because constructing the real clients here
 * would mean connecting to Redis.
 */
function readSource(relative: string): string {
  return readFileSync(path.resolve(__dirname, "..", "..", relative), "utf8")
}

/** These files explain the settings in prose, so assert against code only. */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

describe("Redis client deadlines", () => {
  it("gives the API's command client a finite retry budget", () => {
    const src = readCode("apps/api/src/plugins/redis.ts")
    expect(src).toMatch(/commandTimeout:\s*REDIS_COMMAND_TIMEOUT_MS/)
    expect(src).toMatch(/connectTimeout:\s*REDIS_CONNECT_TIMEOUT_MS/)
    // The BullMQ setting that caused the hang must not come back here.
    expect(src).not.toMatch(/maxRetriesPerRequest:\s*null/)
  })

  it("gives the API's queue producers a command deadline", () => {
    const src = readCode("apps/api/src/services/jobs/queues.ts")
    expect(src).toMatch(/commandTimeout:\s*REDIS_COMMAND_TIMEOUT_MS/)
    expect(src).toMatch(/connectTimeout:\s*REDIS_CONNECT_TIMEOUT_MS/)
  })

  it("keeps the worker's BullMQ connection unbounded, because its reads block", () => {
    // The opposite requirement, and just as load-bearing: a Worker parks on a
    // blocking read waiting for jobs. Timing that out kills the fetch loop and
    // leaves uploads stuck on "Processing" — the bug that setting exists to fix.
    const src = readCode("apps/worker/src/index.ts")
    const connectionBlock = src.slice(src.indexOf("const connection = {"), src.indexOf("async function start()"))
    expect(connectionBlock).toMatch(/maxRetriesPerRequest:\s*null/)
    expect(connectionBlock).not.toMatch(/commandTimeout/)
  })

  it("still bounds the worker's own command client", () => {
    const src = readCode("apps/worker/src/index.ts")
    const startBlock = src.slice(src.indexOf("async function start()"))
    expect(startBlock).toMatch(/commandTimeout:\s*REDIS_COMMAND_TIMEOUT_MS/)
  })

  it("does not let a failed heartbeat take the worker down", () => {
    const src = readCode("apps/worker/src/index.ts")
    // Commands can reject now; an unhandled rejection would kill the process.
    expect(src).toMatch(/writeHeartbeat[\s\S]{0,200}\.catch\(/)
  })
})
