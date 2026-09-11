import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  buildHostedTokenPayload,
  parseLicensePrivateKey,
  signHostedLicenseToken,
} from "@arciin/config"

import {
  LICENSE_REQUIRED_CODE,
  assertPaidJobEntitlement,
  isLicenseRequiredError,
} from "../../apps/worker/src/services/entitlement"

import { prisma } from "./setup"

/**
 * ARC-010 worker half — paid jobs re-check the Wave 1 trusted snapshot.
 *
 * A job that reached the queue (or was inserted directly) must not execute
 * Gemini / auto-update work after a revoke, a downgrade, or a forged column.
 */

const vendorKey = parseLicensePrivateKey("P1L5nJPd7wq0kUwqhU7SbXe0P4H2fT1YtGxWvBoNsRA")
const VENDOR_KID = "arciin-lic-test"

let instanceId: string

beforeEach(async () => {
  await prisma.instanceConfig.deleteMany()
  const instance = await prisma.instanceConfig.create({
    data: {
      instanceName: "Worker Entitlement",
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

async function writeHosted(input: {
  plan: "free" | "pro" | "team" | "business"
  status?: "active" | "revoked" | "expired" | "inactive"
  token?: string | null
  licensePlanColumn?: string
}) {
  const expiresAt = new Date(Date.now() + 31 * 86_400_000)
  const graceUntil = new Date(Date.now() + 38 * 86_400_000)
  const token =
    input.token !== undefined
      ? input.token
      : signHostedLicenseToken(
          buildHostedTokenPayload({
            licenseId: "lic_worker",
            plan: input.plan,
            status: input.status ?? "active",
            instanceId,
            serverLimit: 1,
            keyPrefix: "ARC_WRK…0001",
            expiresAt,
            graceUntil,
          }),
          vendorKey,
          VENDOR_KID,
        )

  await prisma.instanceConfig.update({
    where: { id: instanceId },
    data: {
      licensePlan: input.licensePlanColumn ?? input.plan,
      licenseStatus: input.status ?? "active",
      licenseKeyPrefix: "ARC_WRK…0001",
      licenseActivatedAt: new Date(),
      licenseExpiresAt: expiresAt,
      licenseGraceUntil: graceUntil,
      licenseSignedToken: token,
      licenseSource: token ? "hosted" : "mock_dev",
    },
  })
}

describe("worker paid-job entitlement", () => {
  it("unpaid jobs do not consult the licence", async () => {
    expect(await assertPaidJobEntitlement(prisma, "analyze_file")).toBeNull()
    expect(await assertPaidJobEntitlement(prisma, "generate_thumbnail")).toBeNull()
  })

  it("refuses transcribe_media on Free", async () => {
    await expect(assertPaidJobEntitlement(prisma, "transcribe_media")).rejects.toMatchObject({
      code: LICENSE_REQUIRED_CODE,
      feature: "ai.chat",
    })
  })

  it("refuses a forged business column", async () => {
    await writeHosted({
      plan: "free",
      token: "not-a-signed-token",
      licensePlanColumn: "business",
    })
    await expect(assertPaidJobEntitlement(prisma, "transcribe_media")).rejects.toSatisfy(
      isLicenseRequiredError,
    )
  })

  it("allows transcribe_media on a verified Pro token", async () => {
    await writeHosted({ plan: "pro" })
    const snapshot = await assertPaidJobEntitlement(prisma, "transcribe_media")
    expect(snapshot?.plan).toBe("pro")
  })

  it("refuses a job that was valid when queued after the token is revoked", async () => {
    await writeHosted({ plan: "pro" })
    await assertPaidJobEntitlement(prisma, "transcribe_media")
    await writeHosted({ plan: "pro", status: "revoked" })
    await expect(assertPaidJobEntitlement(prisma, "transcribe_media")).rejects.toMatchObject({
      code: LICENSE_REQUIRED_CODE,
    })
  })

  it("LicenseRequiredError is unrecoverable so BullMQ will not retry it", async () => {
    try {
      await assertPaidJobEntitlement(prisma, "stage_update")
      throw new Error("expected refusal")
    } catch (error) {
      expect(isLicenseRequiredError(error)).toBe(true)
      expect((error as Error).name).toBe("LicenseRequiredError")
      expect((error as { name: string }).constructor.name).toBe("LicenseRequiredError")
    }
  })
})
