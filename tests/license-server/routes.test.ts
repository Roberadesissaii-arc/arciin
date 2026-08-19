import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { prisma } from "../../apps/license-server/src/db.js"
import { resetRateLimits } from "../../apps/license-server/src/security.js"
import { buildLicenseServer } from "../../apps/license-server/src/server.js"
import { LICENSE_TEST_ADMIN_TOKEN, LICENSE_TEST_SERVICE_TOKEN } from "./test-env"

/**
 * The trust boundary, asserted over HTTP.
 *
 * Privileged licensing routes used to be gated on an *optional* header: if
 * `LICENSE_DEMO_SECRET` was unset the check passed unconditionally, so minting,
 * revoking and hard-deleting licenses were open to anyone who could reach the
 * port. These tests exist so that can never quietly come back — every
 * privileged route is asserted to refuse an unauthenticated caller.
 */

let app: FastifyInstance

const service = { authorization: `Bearer ${LICENSE_TEST_SERVICE_TOKEN}` }
const admin = { authorization: `Bearer ${LICENSE_TEST_ADMIN_TOKEN}` }

beforeAll(async () => {
  app = await buildLicenseServer()
  await app.ready()
})

afterAll(async () => {
  await app.close()
})

beforeEach(async () => {
  resetRateLimits()
  await prisma.activation.deleteMany({})
  await prisma.license.deleteMany({})
  await prisma.customer.deleteMany({})
})

async function issueViaApi(plan = "pro", orderId = `order-${Date.now()}-${Math.random()}`) {
  const res = await app.inject({
    method: "POST",
    url: "/licenses/issue",
    headers: service,
    payload: {
      externalOrderId: orderId,
      plan,
      billingInterval: "monthly",
      customerEmail: "route-test@example.invalid",
      customerName: "Route Test",
    },
  })
  return res.json().data as { licenseKey: string; license: { id: string } }
}

describe("service-tier routes fail closed", () => {
  const privileged = [
    { method: "POST" as const, url: "/licenses/issue" },
    { method: "POST" as const, url: "/licenses/revoke" },
    { method: "GET" as const, url: "/licenses/lookup?licenseKey=whatever" },
    { method: "GET" as const, url: "/licenses/by-order/some-order" },
    { method: "GET" as const, url: "/account/overview?email=a@b.c" },
    { method: "GET" as const, url: "/account/licenses?email=a@b.c" },
    { method: "GET" as const, url: "/account/activations?email=a@b.c" },
    { method: "POST" as const, url: "/account/deactivate-server" },
  ]

  for (const route of privileged) {
    it(`rejects ${route.method} ${route.url} with no credential`, async () => {
      const res = await app.inject({ method: route.method, url: route.url, payload: {} })
      expect(res.statusCode).toBe(401)
    })

    it(`rejects ${route.method} ${route.url} with a wrong credential`, async () => {
      const res = await app.inject({
        method: route.method,
        url: route.url,
        headers: { authorization: "Bearer not-the-right-token-at-all" },
        payload: {},
      })
      expect(res.statusCode).toBe(401)
    })
  }

  it("does not accept a service credential on the admin tier", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/licenses/delete",
      headers: service,
      payload: { licenseId: "anything" },
    })
    expect(res.statusCode).toBe(401)
  })

  it("accepts the admin credential on the admin tier", async () => {
    const issued = await issueViaApi()
    // Deletion is guarded: a live license must be revoked first, so a mistaken
    // call cannot erase billing-relevant history in one step.
    const premature = await app.inject({
      method: "POST",
      url: "/licenses/delete",
      headers: admin,
      payload: { licenseId: issued.license.id },
    })
    expect(premature.statusCode).toBe(409)

    await app.inject({
      method: "POST",
      url: "/licenses/revoke",
      headers: service,
      payload: { licenseId: issued.license.id },
    })

    const res = await app.inject({
      method: "POST",
      url: "/licenses/delete",
      headers: admin,
      payload: { licenseId: issued.license.id },
    })
    expect(res.statusCode).toBe(200)
  })

  it("does not reveal whether a credential is configured", async () => {
    const missing = await app.inject({ method: "POST", url: "/licenses/issue", payload: {} })
    const wrong = await app.inject({
      method: "POST",
      url: "/licenses/issue",
      headers: { authorization: "Bearer wrong" },
      payload: {},
    })
    expect(missing.json()).toEqual(wrong.json())
  })
})

describe("issuance over HTTP", () => {
  it("issues a license for a valid service call", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/licenses/issue",
      headers: service,
      payload: {
        externalOrderId: "http-order-1",
        plan: "pro",
        billingInterval: "monthly",
        customerEmail: "buyer@example.invalid",
        customerName: "Buyer",
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.licenseKey).toMatch(/^arc_pro_[0-9a-f]{32}$/)
  })

  it("replays an order with 200 and no key rather than minting again", async () => {
    const payload = {
      externalOrderId: "http-order-replay",
      plan: "pro",
      billingInterval: "monthly",
      customerEmail: "buyer@example.invalid",
      customerName: "Buyer",
    }
    const first = await app.inject({
      method: "POST",
      url: "/licenses/issue",
      headers: service,
      payload,
    })
    const second = await app.inject({
      method: "POST",
      url: "/licenses/issue",
      headers: service,
      payload,
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(200)
    expect(second.json().data.licenseKey).toBeNull()
    expect(second.json().data.license.id).toBe(first.json().data.license.id)
  })

  it("refuses a plan outside the published set", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/licenses/issue",
      headers: service,
      payload: {
        externalOrderId: "http-order-bad-plan",
        plan: "unlimited",
        billingInterval: "monthly",
        customerEmail: "buyer@example.invalid",
        customerName: "Buyer",
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it("ignores an attempt to smuggle in a bigger server limit", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/licenses/issue",
      headers: service,
      payload: {
        externalOrderId: "http-order-greedy",
        plan: "pro",
        billingInterval: "monthly",
        customerEmail: "buyer@example.invalid",
        customerName: "Buyer",
        serverLimit: 999,
        features: ["business.sso"],
        graceDays: 9000,
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.license.serverLimit).toBe(1)
  })
})

describe("instance-facing status keeps the PII boundary", () => {
  it("requires the instance id as well as the key", async () => {
    const issued = await issueViaApi()
    const res = await app.inject({
      method: "GET",
      url: `/licenses/status?licenseKey=${issued.licenseKey}`,
    })
    expect(res.statusCode).toBe(400)
  })

  it("returns no customer identity", async () => {
    const issued = await issueViaApi()
    await app.inject({
      method: "POST",
      url: "/licenses/activate",
      payload: { licenseKey: issued.licenseKey, instanceId: "status-box" },
    })

    const res = await app.inject({
      method: "GET",
      url: `/licenses/status?licenseKey=${issued.licenseKey}&instanceId=status-box`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.body).not.toContain("route-test@example.invalid")
    expect(res.body).not.toContain("Route Test")
  })
})

describe("the service banner", () => {
  it("does not advertise the API surface", async () => {
    const res = await app.inject({ method: "GET", url: "/" })
    expect(res.body).not.toContain("/licenses/issue")
    expect(res.body).not.toContain("/licenses/demo")
    expect(res.body).not.toContain("3010")
  })
})

describe("rate limiting", () => {
  it("throttles repeated activation attempts and says when to retry", async () => {
    const attempt = () =>
      app.inject({
        method: "POST",
        url: "/licenses/activate",
        payload: { licenseKey: "arc_pro_00000000000000000000000000000000", instanceId: "brute" },
      })

    let limited: Awaited<ReturnType<typeof attempt>> | null = null
    for (let i = 0; i < 40 && !limited; i += 1) {
      const res = await attempt()
      if (res.statusCode === 429) limited = res
    }

    expect(limited).not.toBeNull()
    expect(limited!.headers["retry-after"]).toBeDefined()
  })

  it("leaves a normal check-in cadence well inside the budget", async () => {
    const issued = await issueViaApi()
    await app.inject({
      method: "POST",
      url: "/licenses/activate",
      payload: { licenseKey: issued.licenseKey, instanceId: "polite" },
    })

    // A handful of refreshes is what a real instance does; none should trip.
    for (let i = 0; i < 5; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/licenses/refresh",
        payload: { licenseKey: issued.licenseKey, instanceId: "polite" },
      })
      expect(res.statusCode).toBe(200)
    }
  })
})

describe("the demo minting route", () => {
  it("is closed to a service credential", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/licenses/demo",
      headers: service,
      payload: { plan: "business" },
    })
    expect(res.statusCode).toBe(401)
  })
})
