import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import type { FastifyInstance } from "fastify"
import { generateKeyPairSync } from "node:crypto"

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildHostedTokenPayload,
  hasFeature,
  signHostedLicenseToken,
  licenseTokenVersion,
  verifyHostedLicenseToken,
  defaultPublicKeyRegistry,
} from "@arciin/config"

import { activateLicense, refreshLicense } from "../../apps/api/src/services/license/license-service"
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
  error?: { code?: string; message?: string; details?: unknown }
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

describe("seat management (v1.1.4)", () => {
  it("names the servers holding the seats and points to the real account portal", async () => {
    const issued = await issuePaidOrder({ orderId: `order-seats-${Date.now()}` })
    const key = issued.body.data?.licenseKey
    const held = await authorityCall("/licenses/activate", {
      method: "POST",
      body: JSON.stringify({
        licenseKey: key,
        instanceId: "living-room-nas-0001",
        instanceName: "Living room NAS",
        version: "1.1.3",
        hostname: "private-hostname.lan",
      }),
    })
    expect(held.status).toBe(200)

    const result = await activateLicense(prisma, key!)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe("SERVER_LIMIT_REACHED")
    expect(result.message).toContain("arciin.com/account")
    expect(result.details?.manageUrl).toBe("https://arciin.com/account")
    expect(result.details?.serverLimit).toBe(1)
    expect(result.details?.servers).toEqual([
      expect.objectContaining({ name: "Living room NAS", instanceIdShort: "living-r", version: "1.1.3" }),
    ])
    // Enough to recognise the server, never enough to locate it.
    expect(JSON.stringify(result.details)).not.toContain("private-hostname")
    expect(JSON.stringify(result.details)).not.toContain("living-room-nas-0001")
  })

  it("a released server cannot come back while its seat is taken by another", async () => {
    const issued = await issuePaidOrder({ orderId: `order-rebind-${Date.now()}` })
    const key = issued.body.data?.licenseKey
    const post = (path: string, body: object) =>
      authorityCall(path, { method: "POST", body: JSON.stringify(body) })

    expect((await post("/licenses/activate", { licenseKey: key, instanceId: "box-a" })).status).toBe(200)
    expect((await post("/licenses/deactivate", { licenseKey: key, instanceId: "box-a" })).status).toBe(200)
    expect((await post("/licenses/activate", { licenseKey: key, instanceId: "box-b" })).status).toBe(200)
    const back = await post("/licenses/activate", { licenseKey: key, instanceId: "box-a" })
    expect(back.status).toBe(403)
    expect(back.body.error?.code).toBe("SERVER_LIMIT_REACHED")
  })

  it("drops anything unexpected in the authority's seat details", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "SERVER_LIMIT_REACHED",
            message: "Server limit reached (1).",
            details: {
              serverLimit: 1,
              manageUrl: "https://attacker.example/phish",
              servers: [{ name: "x".repeat(500), instanceIdShort: "abcd1234", activatedAt: "2026-01-01T00:00:00Z", hostname: "leak" }],
            },
          },
        }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    )
    try {
      const result = await activateLicense(prisma, "arc_pro_0123456789abcdef0123456789abcdef")
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.details?.manageUrl).toBe("https://arciin.com/account")
      expect(result.details?.servers[0]?.name).toHaveLength(200)
      expect(JSON.stringify(result.details)).not.toContain("leak")
    } finally {
      spy.mockRestore()
    }
  })

  it("refuses a token signed by a key this build does not ship (TOKEN_VERIFY_FAILED)", async () => {
    const { privateKey } = generateKeyPairSync("ed25519")
    const payload = buildHostedTokenPayload({
      licenseId: "lic-unknown-signer",
      plan: "pro",
      status: "active",
      instanceId,
      serverLimit: 1,
      keyPrefix: "ARC_PRO_0000",
      expiresAt: null,
      graceUntil: null,
      activationId: "act-1",
    })
    const token = signHostedLicenseToken(payload, privateKey, "arciin-lic-2099-01")
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            token,
            payload,
            activation: { id: "act-1", instanceId, instanceName: null, lastCheckInAt: null, activatedAt: new Date().toISOString() },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    try {
      const result = await activateLicense(prisma, "arc_pro_0123456789abcdef0123456789abcdef")
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe("TOKEN_VERIFY_FAILED")
      const row = await prisma.instanceConfig.findFirst({ where: { id: instanceId } })
      expect(row?.licensePlan).not.toBe("pro")
    } finally {
      spy.mockRestore()
    }
  })

  it("clears premium state when the authority says the instance is not authorised (UNAUTHORIZED_INSTANCE)", async () => {
    await prisma.instanceConfig.update({
      where: { id: instanceId },
      data: { licensePlan: "pro", licenseStatus: "active", licenseSource: "hosted", licenseSignedToken: "arciin-lic.v3.stale.sig" },
    })
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "UNAUTHORIZED_INSTANCE", message: "Not this instance." } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    )
    try {
      const snapshot = await refreshLicense(prisma)
      expect(snapshot.plan).toBe("free")
      const row = await prisma.instanceConfig.findFirst({ where: { id: instanceId } })
      expect(row?.licenseSignedToken).toBeNull()
    } finally {
      spy.mockRestore()
    }
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
