import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import type { FastifyInstance } from "fastify"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  hasFeature,
  licenseTokenVersion,
  verifyHostedLicenseToken,
  defaultPublicKeyRegistry,
} from "@arciin/config"

import { activateLicense } from "../../apps/api/src/services/license/license-service"
import { requireFeature } from "../../apps/api/src/services/security/auth"
import { prisma } from "./setup"

/**
 * Website purchase → authority issue → customer activation → feature gate.
 *
 * Stripe/payment is the only mocked boundary: a paid order is assumed captured
 * and then the same `POST /licenses/issue` call the website makes after
 * checkout is exercised for real.
 */

const LICENSE_DB = "/tmp/arciin-integration-license/licenses.db"
const SERVICE_TOKEN = "test-service-token-aaaaaaaaaaaaaaaaaaaa"
const SIGNING_KID = "arciin-lic-test"
const AUTHORITY = "http://127.0.0.1:4398"

function publicKeysOnly() {
  return defaultPublicKeyRegistry(process.env.ARCIIN_LICENSE_PUBLIC_KEYS)
}

type LicenseServerBody = {
  data?: {
    licenseKey?: string | null
    token?: string
    license?: { plan?: string }
    servers?: { activated?: number; limit?: number }
    payload?: { status?: string }
    activation?: { lastCheckInAt?: string }
  }
  error?: { code?: string; message?: string }
}

let authority: FastifyInstance
let instanceId: string

async function issuePaidOrder(input: {
  plan?: string
  orderId: string
  email?: string
}): Promise<{ status: number; body: LicenseServerBody }> {
  const res = await fetch(`${AUTHORITY}/licenses/issue`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SERVICE_TOKEN}`,
    },
    body: JSON.stringify({
      externalOrderId: input.orderId,
      plan: input.plan ?? "pro",
      billingInterval: "monthly",
      customerEmail: input.email ?? "buyer@example.invalid",
      customerName: "Website Buyer",
    }),
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as LicenseServerBody }
}

async function authorityCall(path: string, init: RequestInit = {}) {
  const res = await fetch(`${AUTHORITY}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  })
  return { status: res.status, body: (await res.json().catch(() => ({}))) as LicenseServerBody }
}

async function resetCustomerInstance() {
  await prisma.instanceConfig.deleteMany()
  const instance = await prisma.instanceConfig.create({
    data: {
      instanceName: "Purchase Activation Instance",
      storageRoot: "/tmp/arciin-integration-storage",
      initializedAt: new Date(),
      licensePlan: "free",
      licenseStatus: "none",
    },
  })
  instanceId = instance.id
}

beforeAll(async () => {
  if (!LICENSE_DB.startsWith("/tmp/")) {
    throw new Error("Refusing to use a license database outside /tmp.")
  }
  fs.rmSync(path.dirname(LICENSE_DB), { recursive: true, force: true })
  fs.mkdirSync(path.dirname(LICENSE_DB), { recursive: true })
  execFileSync(
    "npx",
    ["prisma", "db", "push", "--schema", "apps/license-server/prisma/schema.prisma", "--skip-generate"],
    {
      cwd: path.resolve(import.meta.dirname, "../.."),
      env: { ...process.env, LICENSE_DATABASE_URL: `file:${LICENSE_DB}` },
      stdio: "pipe",
    },
  )

  const { buildLicenseServer } = await import("../../apps/license-server/src/server.js")
  authority = await buildLicenseServer()
  await authority.listen({ port: 4398, host: "127.0.0.1" })
})

afterAll(async () => {
  if (authority) await authority.close()
  await prisma.instanceConfig.deleteMany()
  await prisma.$disconnect()
})

beforeEach(async () => {
  await resetCustomerInstance()
})

describe("website purchase issues a license (ARC-016)", () => {
  it("fulfills a paid order through the authority", async () => {
    const { status, body } = await issuePaidOrder({ orderId: `order-success-${Date.now()}` })
    expect([200, 201]).toContain(status)
    expect(body.data?.licenseKey).toMatch(/^(ARC-|arc_)/)
    expect(body.data?.license?.plan).toBe("pro")
  })
})

describe("customer activation unlocks a paid gate (ARC-016)", () => {
  it("activates, verifies the signature, and allows a paid endpoint", async () => {
    const issued = await issuePaidOrder({ orderId: `order-activate-${Date.now()}` })
    const key = issued.body.data?.licenseKey
    expect(key).toBeTruthy()

    const result = await activateLicense(prisma, key!)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.snapshot.plan).toBe("pro")
    expect(result.snapshot.premiumActive).toBe(true)
    expect(result.snapshot.signedToken).toBeTruthy()
    expect(licenseTokenVersion(result.snapshot.signedToken!)).toBe(3)

    const payload = verifyHostedLicenseToken(result.snapshot.signedToken!, {
      publicKeys: publicKeysOnly(),
      expectedInstanceId: instanceId,
    })
    expect(payload).not.toBeNull()
    expect(payload!.kid).toBe(SIGNING_KID)
    expect(payload!.features).toContain("vault.password")

    const reply = {
      sent: false,
      statusCode: 200,
      body: null as unknown,
      status(code: number) {
        this.statusCode = code
        return this
      },
      send(body: unknown) {
        this.sent = true
        this.body = body
        return this
      },
    }
    await requireFeature("vault.password")({ server: { prisma } } as never, reply as never)
    expect(reply.sent).toBe(false)
    expect(hasFeature(result.snapshot, "vault.password")).toBe(true)
    expect(hasFeature(result.snapshot, "core.files")).toBe(true)
  })
})

describe("activation failure paths (ARC-016)", () => {
  it("rejects an invalid license key", async () => {
    const result = await activateLicense(prisma, "ARC-NOT-A-REAL-KEY-0000")
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toMatch(/INVALID|UNRECOGNIZED|NOT_FOUND|LICENSE/)
    const row = await prisma.instanceConfig.findFirst({ where: { id: instanceId } })
    expect(row?.licensePlan === "pro" || row?.licensePlan === "PRO").toBe(false)
  })

  it("rejects a revoked license and keeps paid features off", async () => {
    const issued = await issuePaidOrder({ orderId: `order-revoke-${Date.now()}` })
    const key = issued.body.data?.licenseKey
    expect(key).toBeTruthy()

    const revoked = await authorityCall("/licenses/revoke", {
      method: "POST",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
      body: JSON.stringify({ licenseKey: key }),
    })
    expect(revoked.status).toBe(200)

    const result = await activateLicense(prisma, key!)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("LICENSE_REVOKED")

    const gate = {
      sent: false,
      statusCode: 200,
      status(code: number) {
        this.statusCode = code
        return this
      },
      send() {
        this.sent = true
        return this
      },
    }
    await requireFeature("vault.password")({ server: { prisma } } as never, gate as never)
    expect(gate.sent).toBe(true)
    expect(gate.statusCode).toBe(403)
  })

  it("rejects a token bound to a different instance", async () => {
    const issued = await issuePaidOrder({ orderId: `order-bind-${Date.now()}` })
    const activated = await authorityCall("/licenses/activate", {
      method: "POST",
      body: JSON.stringify({
        licenseKey: issued.body.data?.licenseKey,
        instanceId: "other-instance-id",
        instanceName: "Someone Else",
      }),
    })
    expect(activated.status).toBe(200)
    const token = activated.body.data?.token
    expect(token).toBeTruthy()
    expect(
      verifyHostedLicenseToken(token!, {
        publicKeys: publicKeysOnly(),
        expectedInstanceId: instanceId,
      }),
    ).toBeNull()
  })

  it("enforces Pro seat limits on a second instance", async () => {
    const issued = await issuePaidOrder({ orderId: `order-seat-${Date.now()}` })
    const key = issued.body.data?.licenseKey
    const first = await authorityCall("/licenses/activate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: key, instanceId: "seat-a" }),
    })
    expect(first.status).toBe(200)
    const second = await authorityCall("/licenses/activate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: key, instanceId: "seat-b" }),
    })
    expect(second.status).toBe(403)
    expect(second.body.error?.code).toBe("SERVER_LIMIT_REACHED")
  })
})

describe("signing material stays out of logs (ARC-016)", () => {
  it("does not print the test signing private key", async () => {
    const issued = await issuePaidOrder({ orderId: `order-log-${Date.now()}` })
    expect(JSON.stringify(issued.body)).not.toContain(process.env.LICENSE_SIGNING_KEY)
    expect(issued.body.data?.licenseKey).toBeTruthy()
  })
})

describe("authority unavailable leaves the instance safe (ARC-016)", () => {
  it("fails closed and does not unlock paid features", async () => {
    const issued = await issuePaidOrder({ orderId: `order-down-${Date.now()}` })
    const key = issued.body.data?.licenseKey
    expect(key).toBeTruthy()

    await authority.close()
    const result = await activateLicense(prisma, key!)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toMatch(/UNREACHABLE|LICENSE_SERVER/)
    const row = await prisma.instanceConfig.findFirst({ where: { id: instanceId } })
    expect(row?.licensePlan ?? "free").not.toBe("pro")
  })
})
