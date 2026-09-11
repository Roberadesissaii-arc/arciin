import type { FastifyReply, FastifyRequest } from "fastify"
import { generateKeyPairSync } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  buildHostedTokenPayload,
  parseLicensePrivateKey,
  signHostedLicenseToken,
} from "@arciin/config"

import { activateMockLicense } from "../../apps/api/src/services/license/license-service"
import { requireFeature } from "../../apps/api/src/services/security/auth"

import { prisma } from "./setup"

/**
 * ARC-001 — a database column must not be able to grant a paid entitlement.
 *
 * The audit forged Business by running a single UPDATE against InstanceConfig:
 * the row said `business`, the token column held an arbitrary string, and every
 * paid gate opened. Nothing verified the signature on the read path, so the
 * columns *were* the authority.
 *
 * These tests drive the real `requireFeature` preHandler against real rows. The
 * property under test is narrow and absolute: paid features come from a token
 * this build can verify against a vendor public key, and from nothing else.
 *
 * The mirror-image case matters just as much and is asserted here too — a
 * genuinely signed licence has to keep working, or the fix has simply traded a
 * security bug for a billing one.
 */

/** The vendor. In production the private half exists only on the authority. */
const VENDOR_SIGNING_KEY = "P1L5nJPd7wq0kUwqhU7SbXe0P4H2fT1YtGxWvBoNsRA"
const VENDOR_KID = "arciin-lic-test"
const vendorKey = parseLicensePrivateKey(VENDOR_SIGNING_KEY)

/** Someone holding only the public keys, trying to mint their own entitlement. */
function attackerKeypair() {
  const { privateKey } = generateKeyPairSync("ed25519")
  const d = (privateKey.export({ format: "jwk" }) as { d: string }).d
  return parseLicensePrivateKey(d)
}

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

async function runGate(feature: Parameters<typeof requireFeature>[0]) {
  const reply = fakeReply()
  await requireFeature(feature)(fakeRequest(), reply)
  return reply.captured
}

/** The three gates the audit demonstrated the forgery against. */
const AUDITED_PAID_GATES = ["developer.api_keys", "ai.chat", "developer.webhooks"] as const

/** Free core must survive every licensing outcome — this is data access. */
const FREE_CORE = ["core.files", "core.libraries", "core.uploads"] as const

async function expectPaidGatesClosed() {
  for (const feature of AUDITED_PAID_GATES) {
    const captured = await runGate(feature)
    expect(captured.status, `${feature} must be refused`).toBe(403)
    expect(captured.body).toMatchObject({ error: { code: "LICENSE_REQUIRED" } })
  }
}

async function expectFreeCoreOpen() {
  for (const feature of FREE_CORE) {
    expect((await runGate(feature)).status, `${feature} must stay reachable`).toBeNull()
  }
}

let instanceId: string

beforeEach(async () => {
  await prisma.instanceConfig.deleteMany()
  const instance = await prisma.instanceConfig.create({
    data: {
      instanceName: "Forgery Test",
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

/** Sign a token the way the authority would, for this instance. */
function issueToken(
  overrides: {
    plan?: "free" | "pro" | "team" | "business"
    status?: "active" | "revoked" | "expired" | "grace" | "inactive"
    instanceId?: string
    expiresAt?: Date | null
    graceUntil?: Date | null
    kid?: string
    signWith?: ReturnType<typeof parseLicensePrivateKey>
  } = {},
) {
  const payload = buildHostedTokenPayload({
    licenseId: "lic_test_1",
    plan: overrides.plan ?? "pro",
    status: overrides.status ?? "active",
    instanceId: overrides.instanceId ?? instanceId,
    serverLimit: 1,
    keyPrefix: "ARC_PRO…ABCD",
    expiresAt: overrides.expiresAt === undefined ? new Date(Date.now() + 31 * 86_400_000) : overrides.expiresAt,
    graceUntil: overrides.graceUntil === undefined ? new Date(Date.now() + 38 * 86_400_000) : overrides.graceUntil,
  })
  return signHostedLicenseToken(payload, overrides.signWith ?? vendorKey, overrides.kid ?? VENDOR_KID)
}

/** Write an entitlement row exactly as a successful activation would. */
async function storeLicense(data: {
  plan: string
  status: string
  token: string | null
  expiresAt?: Date | null
  graceUntil?: Date | null
}) {
  await prisma.instanceConfig.update({
    where: { id: instanceId },
    data: {
      licensePlan: data.plan,
      licenseStatus: data.status,
      licenseKeyPrefix: "ARC_PRO…ABCD",
      licenseActivatedAt: new Date(),
      licenseExpiresAt: data.expiresAt === undefined ? new Date(Date.now() + 31 * 86_400_000) : data.expiresAt,
      licenseGraceUntil: data.graceUntil === undefined ? new Date(Date.now() + 38 * 86_400_000) : data.graceUntil,
      licenseSignedToken: data.token,
      licenseSource: "hosted",
    },
  })
}

describe("the audit's exact forgery", () => {
  beforeEach(async () => {
    await storeLicense({
      plan: "business",
      status: "active",
      token: "FORGED-NOT-A-REAL-TOKEN",
    })
  })

  it("does not unlock the paid gates it previously unlocked", async () => {
    await expectPaidGatesClosed()
  })

  it("does not unlock a paid write action", async () => {
    // POST /api/api-keys sits behind the same preHandler as the listing.
    const captured = await runGate("developer.api_keys")
    expect(captured.status).toBe(403)
  })

  it("reports the instance as free rather than business", async () => {
    const captured = await runGate("ai.chat")
    expect(captured.body).toMatchObject({ error: { details: { plan: "free" } } })
  })

  it("still leaves the customer's own files reachable", async () => {
    await expectFreeCoreOpen()
  })
})

describe("tokens that fail verification", () => {
  it("refuses a paid plan with no token at all", async () => {
    await storeLicense({ plan: "business", status: "active", token: null })
    await expectPaidGatesClosed()
  })

  it("refuses an empty-string token", async () => {
    await storeLicense({ plan: "business", status: "active", token: "" })
    await expectPaidGatesClosed()
  })

  it("refuses a token that is structurally right but signed by someone else", async () => {
    await storeLicense({
      plan: "business",
      status: "active",
      token: issueToken({ plan: "business", signWith: attackerKeypair() }),
    })
    await expectPaidGatesClosed()
  })

  it("refuses a token signed under a key id this build does not ship", async () => {
    await storeLicense({
      plan: "pro",
      status: "active",
      token: issueToken({ kid: "some-key-we-do-not-ship" }),
    })
    await expectPaidGatesClosed()
  })

  it("refuses a token whose body was edited after signing", async () => {
    const good = issueToken({ plan: "pro" })
    const [prefix, version, body, sig] = good.split(".")
    const decoded = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"))
    decoded.plan = "business"
    const tampered = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url")
    await storeLicense({
      plan: "business",
      status: "active",
      token: `${prefix}.${version}.${tampered}.${sig}`,
    })
    await expectPaidGatesClosed()
  })

  it("refuses a token issued to a different instance", async () => {
    await storeLicense({
      plan: "pro",
      status: "active",
      token: issueToken({ instanceId: "some-other-install" }),
    })
    await expectPaidGatesClosed()
  })

  it("refuses a token the authority marked revoked", async () => {
    await storeLicense({
      plan: "pro",
      status: "active",
      token: issueToken({ status: "revoked" }),
    })
    await expectPaidGatesClosed()
  })

  it("keeps free core reachable through every rejection", async () => {
    await storeLicense({ plan: "business", status: "active", token: "not-a-token" })
    await expectFreeCoreOpen()
  })
})

describe("a genuinely signed licence", () => {
  it("still unlocks everything the plan sells", async () => {
    await storeLicense({ plan: "pro", status: "active", token: issueToken({ plan: "pro" }) })

    for (const feature of AUDITED_PAID_GATES) {
      expect((await runGate(feature)).status, `${feature} must be allowed`).toBeNull()
    }
    expect((await runGate("vault.password")).status).toBeNull()
  })

  it("unlocks Team capabilities for a signed Team licence", async () => {
    await storeLicense({ plan: "team", status: "active", token: issueToken({ plan: "team" }) })
    expect((await runGate("team.multi_user")).status).toBeNull()
  })

  it("keeps working inside the grace window after expiry", async () => {
    const expiresAt = new Date(Date.now() - 86_400_000)
    const graceUntil = new Date(Date.now() + 6 * 86_400_000)
    await storeLicense({
      plan: "pro",
      status: "active",
      token: issueToken({ plan: "pro", expiresAt, graceUntil }),
      expiresAt,
      graceUntil,
    })
    expect((await runGate("vault.password")).status).toBeNull()
  })

  it("stops once the grace window has passed", async () => {
    const expiresAt = new Date(Date.now() - 30 * 86_400_000)
    const graceUntil = new Date(Date.now() - 23 * 86_400_000)
    await storeLicense({
      plan: "pro",
      status: "active",
      token: issueToken({ plan: "pro", expiresAt, graceUntil }),
      expiresAt,
      graceUntil,
    })
    expect((await runGate("vault.password")).status).toBe(403)
    await expectFreeCoreOpen()
  })
})

describe("when the token and the columns disagree", () => {
  /**
   * The token wins. This is the shape of the original attack that survives a
   * naive fix: keep a real Pro token, then edit the plan column up to Business
   * and hope the column is what gets read.
   */
  it("grants only what the signed token says, not the upgraded column", async () => {
    await storeLicense({
      plan: "business",
      status: "active",
      token: issueToken({ plan: "pro" }),
    })

    expect((await runGate("vault.password")).status).toBeNull()
    expect((await runGate("team.multi_user")).status).toBe(403)
    expect((await runGate("business.sso")).status).toBe(403)
  })

  it("ignores a column that claims a longer runway than the token", async () => {
    const expiresAt = new Date(Date.now() - 30 * 86_400_000)
    const graceUntil = new Date(Date.now() - 23 * 86_400_000)
    await storeLicense({
      plan: "pro",
      status: "active",
      // Columns pushed far into the future; the token is long dead.
      token: issueToken({ plan: "pro", expiresAt, graceUntil }),
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
      graceUntil: new Date(Date.now() + 372 * 86_400_000),
    })
    expect((await runGate("vault.password")).status).toBe(403)
  })
})

describe("a free instance", () => {
  it("keeps free core and refuses paid features", async () => {
    await expectFreeCoreOpen()
    await expectPaidGatesClosed()
  })
})

describe("local dev activation", () => {
  /**
   * Dev keys are signed too — with this instance's own secret rather than the
   * vendor's — so hardening the read path must not break local workflows.
   */
  it("still unlocks Pro for a DEV key", async () => {
    const result = await activateMockLicense(prisma, "DEV-PRO")
    expect(result.ok).toBe(true)
    expect((await runGate("vault.password")).status).toBeNull()
  })

  it("stops honouring the dev entitlement once its token is tampered with", async () => {
    await activateMockLicense(prisma, "DEV-PRO")
    const row = await prisma.instanceConfig.findFirstOrThrow()
    const [prefix, version, body] = row.licenseSignedToken!.split(".")
    await prisma.instanceConfig.update({
      where: { id: instanceId },
      data: { licenseSignedToken: `${prefix}.${version}.${body}.wrongsignature` },
    })

    await expectPaidGatesClosed()
    await expectFreeCoreOpen()
  })
})
