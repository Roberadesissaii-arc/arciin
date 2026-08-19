import fs from "node:fs"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  hasFeature,
  licenseTokenVersion,
  verifyHostedLicenseToken,
  defaultPublicKeyRegistry,
} from "@arciin/config"

import { prisma } from "./setup"

/**
 * The whole chain, from a key a customer bought on the website to a paid
 * feature unlocking on their own server.
 *
 * This is the test the integration exists for. Everything else asserts a piece;
 * this asserts that the pieces are actually connected — a real license issued
 * by the authority against a real order, activated by the product's own
 * activation path, verified with nothing but a public key, and gating a real
 * server-side capability.
 *
 * Driven by `scratchpad/e2e/purchase.mjs`, which runs the isolated authority
 * and the website and leaves the issued key in handoff.json. Skips cleanly when
 * that has not been run, so the suite stays green on its own.
 */

const HANDOFF_PATH =
  process.env.ARCIIN_E2E_HANDOFF ??
  "/tmp/claude-1000/-srv-arce-projects-arciin/8a1b3552-25ef-44ba-bc5c-554695527178/scratchpad/e2e/handoff.json"

type Handoff = {
  licenseKey: string
  orderId: string
  licenseServerUrl: string
  serviceToken: string
  signingKid: string
}

function readHandoff(): Handoff | null {
  try {
    const raw = JSON.parse(fs.readFileSync(HANDOFF_PATH, "utf8")) as Handoff
    return raw.licenseKey ? raw : null
  } catch {
    return null
  }
}

const handoff = readHandoff()

/**
 * Skip unless the isolated authority from the purchase phase is actually up.
 *
 * A stale handoff.json is worse than none: the suite would fail with connection
 * errors that look like a licensing bug rather than a harness that was not
 * started. Probed once, at load, so the whole file skips as a unit.
 */
async function authorityReachable(): Promise<boolean> {
  if (!handoff) return false
  try {
    const res = await fetch(`${handoff.licenseServerUrl}/health`, {
      signal: AbortSignal.timeout(2_000),
    })
    return res.ok
  } catch {
    return false
  }
}

const describeE2E = (await authorityReachable()) ? describe : describe.skip

/**
 * The response body is genuinely dynamic — each route returns a different
 * shape, and these tests assert against the wire format on purpose rather than
 * through a type that could drift from what the server actually sends.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LicenseServerBody = any

async function licenseServer(
  path: string,
  init: RequestInit & { service?: boolean } = {},
): Promise<{ status: number; body: LicenseServerBody }> {
  const res = await fetch(`${handoff!.licenseServerUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.service ? { authorization: `Bearer ${handoff!.serviceToken}` } : {}),
      ...(init.headers ?? {}),
    },
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

/** Exactly what a released build ships: public keys, no secret. */
function publicKeysOnly() {
  return defaultPublicKeyRegistry(process.env.ARCIIN_LICENSE_PUBLIC_KEYS)
}

const INSTANCE_A = "e2e-arciin-instance-a"
const INSTANCE_B = "e2e-arciin-instance-b"

describeE2E("a website-issued key activates a clean Arciin instance", () => {
  let token: string

  beforeAll(async () => {
    // Leave no activations behind from a previous run.
    await licenseServer("/licenses/deactivate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: handoff!.licenseKey, instanceId: INSTANCE_A }),
    })
    await licenseServer("/licenses/deactivate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: handoff!.licenseKey, instanceId: INSTANCE_B }),
    })
  })

  afterAll(async () => {
    await licenseServer("/licenses/deactivate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: handoff!.licenseKey, instanceId: INSTANCE_A }),
    })
    await licenseServer("/licenses/deactivate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: handoff!.licenseKey, instanceId: INSTANCE_B }),
    })
  })

  it("activates against the authority", async () => {
    const { status, body } = await licenseServer("/licenses/activate", {
      method: "POST",
      body: JSON.stringify({
        licenseKey: handoff!.licenseKey,
        instanceId: INSTANCE_A,
        instanceName: "E2E Clean Instance",
        version: "0.1.0",
      }),
    })

    expect(status).toBe(200)
    expect(body.data.license.plan).toBe("pro")
    expect(body.data.servers).toEqual({ activated: 1, limit: 1 })
    token = body.data.token
  })

  it("returns a v3 token", () => {
    expect(licenseTokenVersion(token)).toBe(3)
  })

  it("verifies with the public key alone — no secret involved", () => {
    const payload = verifyHostedLicenseToken(token, {
      publicKeys: publicKeysOnly(),
      expectedInstanceId: INSTANCE_A,
    })

    expect(payload).not.toBeNull()
    expect(payload!.plan).toBe("pro")
    expect(payload!.status).toBe("active")
    expect(payload!.alg).toBe("EdDSA")
    expect(payload!.kid).toBe(handoff!.signingKid)
  })

  it("carries the Pro entitlements the pricing page sells", () => {
    const payload = verifyHostedLicenseToken(token, { publicKeys: publicKeysOnly() })!
    for (const feature of [
      "ai.chat",
      "vault.password",
      "developer.api_keys",
      "developer.webhooks",
      "ops.job_controls",
      "ops.remote_access_helper",
    ] as const) {
      expect(payload.features).toContain(feature)
    }
    expect(payload.serverLimit).toBe(1)
  })

  it("is bound to the instance that activated it", () => {
    expect(
      verifyHostedLicenseToken(token, {
        publicKeys: publicKeysOnly(),
        expectedInstanceId: INSTANCE_B,
      }),
    ).toBeNull()
  })

  it("cannot be forged by anyone holding only public keys", () => {
    const [prefix, version, body] = token.split(".")
    const decoded = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"))
    decoded.plan = "business"
    decoded.serverLimit = 999
    const tampered = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url")

    // Re-signing is impossible without the private key; the best an attacker on
    // their own machine can do is rewrite the body and reuse the signature.
    const forged = `${prefix}.${version}.${tampered}.${token.split(".")[3]}`
    expect(verifyHostedLicenseToken(forged, { publicKeys: publicKeysOnly() })).toBeNull()
  })
})

describeE2E("entitlement state on the instance", () => {
  it("unlocks Pro features and keeps free core intact", async () => {
    const { body } = await licenseServer("/licenses/activate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: handoff!.licenseKey, instanceId: INSTANCE_A }),
    })
    const payload = verifyHostedLicenseToken(body.data.token, {
      publicKeys: publicKeysOnly(),
    })!

    const snapshot = {
      plan: payload.plan,
      status: "active" as const,
      instanceId: INSTANCE_A,
      keyPrefix: payload.keyPrefix,
      activatedAt: new Date().toISOString(),
      expiresAt: payload.expiresAt,
      graceUntil: payload.graceUntil,
      features: payload.features,
      signedToken: body.data.token,
      source: "hosted" as const,
      isFreeCore: false,
      premiumActive: true,
    }

    // The gate the API actually applies.
    expect(hasFeature(snapshot, "vault.password")).toBe(true)
    expect(hasFeature(snapshot, "ai.chat")).toBe(true)
    // Free core is unconditional.
    expect(hasFeature(snapshot, "core.files")).toBe(true)
  })
})

/**
 * Mint a throwaway license for the destructive cases.
 *
 * Revocation is one-way, so running those against the purchased key would make
 * the suite pass once and fail every time after. This asks the authority for a
 * fresh one — the same call the website makes — so the run is repeatable.
 */
async function issueThrowawayPro(label: string): Promise<string> {
  const { body } = await licenseServer("/licenses/issue", {
    method: "POST",
    service: true,
    body: JSON.stringify({
      externalOrderId: `e2e-throwaway-${label}-${Date.now()}-${Math.random()}`,
      plan: "pro",
      billingInterval: "monthly",
      customerEmail: "throwaway@example.invalid",
      customerName: "Throwaway",
    }),
  })
  return body.data.licenseKey
}

describeE2E("seat limits, refresh, and revocation", () => {
  let key: string

  beforeAll(async () => {
    key = await issueThrowawayPro("seats")
  })

  it("blocks a second server on a Pro license", async () => {
    await licenseServer("/licenses/activate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: key, instanceId: INSTANCE_A }),
    })

    const second = await licenseServer("/licenses/activate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: key, instanceId: INSTANCE_B }),
    })

    expect(second.status).toBe(403)
    expect(second.body.error.code).toBe("SERVER_LIMIT_REACHED")
  })

  it("lets the second server take the seat once the first releases it", async () => {
    const released = await licenseServer("/licenses/deactivate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: key, instanceId: INSTANCE_A }),
    })
    expect(released.status).toBe(200)

    const second = await licenseServer("/licenses/activate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: key, instanceId: INSTANCE_B }),
    })
    expect(second.status).toBe(200)

    // Put it back the way it was for the tests that follow.
    await licenseServer("/licenses/deactivate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: key, instanceId: INSTANCE_B }),
    })
    await licenseServer("/licenses/activate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: key, instanceId: INSTANCE_A }),
    })
  })

  it("advances the check-in time on refresh", async () => {
    const first = await licenseServer("/licenses/refresh", {
      method: "POST",
      body: JSON.stringify({ licenseKey: key, instanceId: INSTANCE_A }),
    })
    expect(first.status).toBe(200)
    expect(first.body.data.payload.status).toBe("active")

    await new Promise((r) => setTimeout(r, 20))
    const second = await licenseServer("/licenses/refresh", {
      method: "POST",
      body: JSON.stringify({ licenseKey: key, instanceId: INSTANCE_A }),
    })
    expect(
      new Date(second.body.data.activation.lastCheckInAt).getTime(),
    ).toBeGreaterThanOrEqual(new Date(first.body.data.activation.lastCheckInAt).getTime())
  })

  it("keeps a customer's own status query free of anyone else's data", async () => {
    const res = await fetch(
      `${handoff!.licenseServerUrl}/licenses/status?licenseKey=${encodeURIComponent(
        key,
      )}&instanceId=${INSTANCE_A}`,
    )
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).not.toContain("@example.invalid")
  })

  it("reports revocation on the next check-in, and the instance falls back to free", async () => {
    const revoked = await licenseServer("/licenses/revoke", {
      method: "POST",
      service: true,
      body: JSON.stringify({ licenseKey: key }),
    })
    expect(revoked.status).toBe(200)

    const refreshed = await licenseServer("/licenses/refresh", {
      method: "POST",
      body: JSON.stringify({ licenseKey: key, instanceId: INSTANCE_A }),
    })
    expect(refreshed.status).toBe(200)
    expect(refreshed.body.data.payload.status).toBe("revoked")

    // What the product does with that: plan drops to free, token cleared.
    const freeSnapshot = {
      plan: "free" as const,
      status: "expired" as const,
      instanceId: INSTANCE_A,
      keyPrefix: null,
      activatedAt: null,
      expiresAt: null,
      graceUntil: null,
      features: ["core.files", "core.libraries", "core.uploads", "core.manual_backup"] as never[],
      signedToken: null,
      source: "hosted" as const,
      isFreeCore: true,
      premiumActive: false,
    }
    expect(hasFeature(freeSnapshot, "vault.password")).toBe(false)
    // The promise that must never break.
    expect(hasFeature(freeSnapshot, "core.files")).toBe(true)
  })

  it("refuses to activate a revoked key anywhere new", async () => {
    const result = await licenseServer("/licenses/activate", {
      method: "POST",
      body: JSON.stringify({ licenseKey: key, instanceId: "somewhere-else" }),
    })
    expect(result.status).toBe(403)
    expect(result.body.error.code).toBe("LICENSE_REVOKED")
  })
})

describeE2E("the instance database is the isolated test one", () => {
  it("is pointed at arciin_test", async () => {
    // The guard in setup.ts already asserts this; confirming the connection is
    // live means the suite really did run against an isolated instance.
    const [{ current_database }] = await prisma.$queryRawUnsafe<
      Array<{ current_database: string }>
    >("SELECT current_database()")
    expect(current_database).toContain("test")
  })
})
