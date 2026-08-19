import type { FastifyReply, FastifyRequest } from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { requireFeature } from "../../apps/api/src/services/security/auth"

import { prisma } from "./setup"

/**
 * The paid gate, exercised as the API applies it.
 *
 * `requireFeature` is the boundary that actually decides whether a customer
 * gets a Pro capability — not the UI, which is presentation and which the
 * entitlement-state tests cover separately. This drives the real preHandler
 * against the real InstanceConfig row, so "Pro unlocks the vault" is asserted
 * where the decision is made.
 */

type Captured = { status: number | null; body: unknown }

/** Minimal reply that records what the preHandler did, and a matching request. */
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

function fakeRequest(): FastifyRequest {
  return { server: { prisma } } as unknown as FastifyRequest
}

let instanceId: string

beforeEach(async () => {
  await prisma.instanceConfig.deleteMany()
  const instance = await prisma.instanceConfig.create({
    data: {
      instanceName: "Feature Gate Test",
      storageRoot: "/tmp/arciin-integration-storage",
      initializedAt: new Date(),
      licensePlan: "free",
      licenseStatus: "none",
    },
  })
  instanceId = instance.id
})

afterEach(async () => {
  await prisma.instanceConfig.deleteMany()
})

async function runGate(feature: Parameters<typeof requireFeature>[0]) {
  const reply = fakeReply()
  await requireFeature(feature)(fakeRequest(), reply)
  return reply.captured
}

/** What activating a hosted Pro license writes to the instance. */
async function activatePro() {
  await prisma.instanceConfig.update({
    where: { id: instanceId },
    data: {
      licensePlan: "pro",
      licenseStatus: "active",
      licenseKeyPrefix: "ARC_PRO…ABCD",
      licenseActivatedAt: new Date(),
      licenseExpiresAt: new Date(Date.now() + 31 * 86_400_000),
      licenseGraceUntil: new Date(Date.now() + 38 * 86_400_000),
      // Any non-null token — the gate reads the persisted plan, and token
      // verification is covered by the activation suite.
      licenseSignedToken: "arclic.v3.stub.stub",
      licenseSource: "hosted",
    },
  })
}

describe("before a license is activated", () => {
  it("refuses the password vault", async () => {
    const captured = await runGate("vault.password")
    expect(captured.status).toBe(403)
    expect(captured.body).toMatchObject({
      error: { code: "LICENSE_REQUIRED" },
    })
  })

  it("refuses AI chat, API keys, webhooks and app databases", async () => {
    for (const feature of [
      "ai.chat",
      "developer.api_keys",
      "developer.webhooks",
      "developer.app_databases",
    ] as const) {
      expect((await runGate(feature)).status).toBe(403)
    }
  })

  it("names the plans that would grant it, so the message is actionable", async () => {
    const captured = await runGate("vault.password")
    expect(captured.body).toMatchObject({
      error: { details: { requiredPlans: ["pro", "team", "business"] } },
    })
  })

  it("still allows free core", async () => {
    expect((await runGate("core.files")).status).toBeNull()
    expect((await runGate("core.uploads")).status).toBeNull()
    expect((await runGate("core.manual_backup")).status).toBeNull()
  })
})

describe("after activating a Pro license", () => {
  beforeEach(activatePro)

  it("allows the password vault", async () => {
    expect((await runGate("vault.password")).status).toBeNull()
  })

  it("allows every Pro capability the pricing page sells", async () => {
    for (const feature of [
      "ai.chat",
      "ai.vision",
      "developer.api_keys",
      "developer.webhooks",
      "developer.app_databases",
      "ops.job_controls",
      "ops.remote_access_helper",
      "search.advanced",
    ] as const) {
      expect((await runGate(feature)).status).toBeNull()
    }
  })

  it("still withholds Team capabilities from a Pro license", async () => {
    for (const feature of ["team.multi_user", "team.roles", "team.audit_logs"] as const) {
      expect((await runGate(feature)).status).toBe(403)
    }
  })
})

describe("after the license is revoked", () => {
  beforeEach(async () => {
    await activatePro()
    // What refreshLicense writes when the authority reports a revocation.
    await prisma.instanceConfig.update({
      where: { id: instanceId },
      data: {
        licensePlan: "free",
        licenseStatus: "expired",
        licenseSignedToken: null,
      },
    })
  })

  it("closes the vault again", async () => {
    expect((await runGate("vault.password")).status).toBe(403)
  })

  it("leaves the customer's files reachable", async () => {
    // Revocation is a commercial event. It must never become a data event.
    expect((await runGate("core.files")).status).toBeNull()
    expect((await runGate("core.libraries")).status).toBeNull()
    expect((await runGate("core.uploads")).status).toBeNull()
    expect((await runGate("core.manual_backup")).status).toBeNull()
  })
})

describe("during the grace period after expiry", () => {
  beforeEach(async () => {
    await activatePro()
    await prisma.instanceConfig.update({
      where: { id: instanceId },
      data: {
        licenseExpiresAt: new Date(Date.now() - 86_400_000),
        licenseGraceUntil: new Date(Date.now() + 6 * 86_400_000),
      },
    })
  })

  it("keeps Pro working, so a payment hiccup is not an outage", async () => {
    expect((await runGate("vault.password")).status).toBeNull()
    expect((await runGate("ai.chat")).status).toBeNull()
  })
})

describe("once grace has run out", () => {
  beforeEach(async () => {
    await activatePro()
    await prisma.instanceConfig.update({
      where: { id: instanceId },
      data: {
        licenseExpiresAt: new Date(Date.now() - 30 * 86_400_000),
        licenseGraceUntil: new Date(Date.now() - 23 * 86_400_000),
      },
    })
  })

  it("withdraws the paid features", async () => {
    expect((await runGate("vault.password")).status).toBe(403)
  })

  it("keeps free core", async () => {
    expect((await runGate("core.files")).status).toBeNull()
  })
})
