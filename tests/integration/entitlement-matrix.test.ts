import type { FastifyReply, FastifyRequest } from "fastify"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  ENTITLEMENT_RUNTIME,
  LICENSE_FEATURES,
  buildHostedTokenPayload,
  isActiveRuntimeEntitlement,
  parseLicensePrivateKey,
  signHostedLicenseToken,
  type LicenseFeatureId,
  type LicensePlanId,
} from "@arciin/config"

import { requireFeature } from "../../apps/api/src/services/security/auth"

import { prisma } from "./setup"

/**
 * ARC-010 — every ACTIVE shipped paid entitlement is refused on Free and
 * accepted on a verified paid token. Placeholders are not given fake routes.
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

function fakeRequest(): FastifyRequest {
  return { server: { prisma } } as unknown as FastifyRequest
}

const vendorKey = parseLicensePrivateKey("P1L5nJPd7wq0kUwqhU7SbXe0P4H2fT1YtGxWvBoNsRA")
const VENDOR_KID = "arciin-lic-test"

/** ACTIVE paid features that have a real requireFeature gate. */
const ACTIVE_PAID_GATES: LicenseFeatureId[] = LICENSE_FEATURES.filter((id) => {
  const row = ENTITLEMENT_RUNTIME[id]
  return isActiveRuntimeEntitlement(id) && Boolean(row.apiGate) && !id.startsWith("core.")
})

let instanceId: string

beforeEach(async () => {
  await prisma.instanceConfig.deleteMany()
  const instance = await prisma.instanceConfig.create({
    data: {
      instanceName: "Entitlement Matrix",
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

async function runGate(feature: LicenseFeatureId) {
  const reply = fakeReply()
  await requireFeature(feature)(fakeRequest(), reply)
  return reply.captured
}

async function writeLicense(input: {
  plan: LicensePlanId
  status?: "active" | "revoked" | "expired" | "inactive"
  token?: string | null
  forgeColumns?: boolean
}) {
  const expiresAt = new Date(Date.now() + 31 * 86_400_000)
  const graceUntil = new Date(Date.now() + 38 * 86_400_000)
  const token =
    input.token !== undefined
      ? input.token
      : signHostedLicenseToken(
          buildHostedTokenPayload({
            licenseId: "lic_matrix",
            plan: input.plan,
            status: input.status ?? "active",
            instanceId,
            serverLimit: 1,
            keyPrefix: "ARC_TST…0001",
            expiresAt,
            graceUntil,
          }),
          vendorKey,
          VENDOR_KID,
        )

  await prisma.instanceConfig.update({
    where: { id: instanceId },
    data: {
      licensePlan: input.forgeColumns ? "business" : input.plan,
      licenseStatus: input.forgeColumns ? "active" : (input.status ?? "active"),
      licenseKeyPrefix: "ARC_TST…0001",
      licenseActivatedAt: new Date(),
      licenseExpiresAt: expiresAt,
      licenseGraceUntil: graceUntil,
      licenseSignedToken: token,
      licenseSource: token ? "hosted" : "mock_dev",
    },
  })
}

describe("ACTIVE paid entitlements", () => {
  it("are a known, non-empty set", () => {
    expect(ACTIVE_PAID_GATES).toEqual(
      expect.arrayContaining([
        "ai.chat",
        "ai.multi_provider",
        "vault.password",
        "developer.api_keys",
        "developer.webhooks",
        "developer.app_databases",
        "ops.auto_updates",
        "ops.remote_access_helper",
        "ops.job_controls",
        "team.multi_user",
      ]),
    )
  })

  it("reject a Free instance on every ACTIVE paid gate", async () => {
    for (const feature of ACTIVE_PAID_GATES) {
      const captured = await runGate(feature)
      expect(captured.status, feature).toBe(403)
      expect(captured.body).toMatchObject({ error: { code: "LICENSE_REQUIRED" } })
    }
  })

  it("allow a verified Pro token on Pro-level ACTIVE gates", async () => {
    await writeLicense({ plan: "pro" })
    for (const feature of ACTIVE_PAID_GATES.filter((id) => ENTITLEMENT_RUNTIME[id].planRequirement === "pro")) {
      expect((await runGate(feature)).status, feature).toBeNull()
    }
    expect((await runGate("team.multi_user")).status).toBe(403)
  })

  it("reject a forged business column with a junk token", async () => {
    await writeLicense({ plan: "free", token: "forged-not-a-token", forgeColumns: true })
    for (const feature of ["ai.chat", "ops.auto_updates", "team.multi_user"] as const) {
      expect((await runGate(feature)).status, feature).toBe(403)
    }
  })

  it("reject a revoked signed token even if columns still say Pro", async () => {
    await writeLicense({ plan: "pro", status: "revoked" })
    expect((await runGate("ai.chat")).status).toBe(403)
    expect((await runGate("ops.auto_updates")).status).toBe(403)
  })
})
