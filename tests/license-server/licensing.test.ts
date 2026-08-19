import { beforeEach, describe, expect, it } from "vitest"

import {
  hashLicenseKey,
  isLicensePlanId,
  serverLimitNumber,
  verifyHostedLicenseToken,
} from "@arciin/config"

import { licenseServerConfig } from "../../apps/license-server/src/config.js"
import { prisma } from "../../apps/license-server/src/db.js"
import {
  activateLicense,
  createDemoLicense,
  deactivateByLicenseId,
  deactivateLicense,
  findLicenseByOrder,
  getInstanceLicenseStatus,
  getLicenseStatus,
  issueLicense,
  refreshLicense,
  revokeLicense,
} from "../../apps/license-server/src/services/license-ops.js"

/**
 * Behaviour of the licensing authority — the rules a customer's money buys.
 *
 * These existed nowhere before the website integration, which meant every
 * property the business depends on (a Pro key works on one server, a revoked
 * key stops working, an expired key falls back to free rather than locking
 * anyone out) was only ever confirmed by hand. They are asserted here against a
 * real database so the Ed25519 migration and the new issuance path had
 * something to be checked against.
 */

let orderCounter = 0
function nextOrderId(label: string): string {
  orderCounter += 1
  return `test-order-${label}-${orderCounter}-${Date.now()}`
}

function verify(token: string, instanceId?: string) {
  return verifyHostedLicenseToken(token, {
    publicKeys: licenseServerConfig.publicKeyRegistry,
    ...(instanceId ? { expectedInstanceId: instanceId } : {}),
  })
}

async function issuePro(email = "pro@example.invalid") {
  const result = await issueLicense({
    externalOrderId: nextOrderId("pro"),
    plan: "pro",
    billingInterval: "monthly",
    customerEmail: email,
    customerName: "Pro Customer",
  })
  if (!result.ok) throw new Error(`issue failed: ${result.message}`)
  return result.data
}

beforeEach(async () => {
  await prisma.activation.deleteMany({})
  await prisma.license.deleteMany({})
  await prisma.customer.deleteMany({})
})

describe("license issuance", () => {
  it("mints a production key with 128 bits of entropy and no 'demo' marking", async () => {
    const issued = await issuePro()
    expect(issued.created).toBe(true)
    expect(issued.licenseKey).toMatch(/^arc_pro_[0-9a-f]{32}$/)
    expect(issued.licenseKey).not.toContain("demo")
  })

  it("never persists the raw key", async () => {
    const issued = await issuePro()
    const row = await prisma.license.findUnique({ where: { id: issued.license.id } })

    expect(row?.demoPlainKey).toBeNull()
    expect(row?.keyHash).toBe(hashLicenseKey(issued.licenseKey!))
    // The prefix is a display form; it must not be the key.
    expect(row?.keyPrefix).not.toBe(issued.licenseKey)
  })

  it("derives the server limit from the plan, ignoring anything a caller might want", async () => {
    const pro = await issuePro()
    expect(pro.license.serverLimit).toBe(serverLimitNumber("pro"))
    expect(pro.license.serverLimit).toBe(1)

    const team = await issueLicense({
      externalOrderId: nextOrderId("team"),
      plan: "team",
      billingInterval: "monthly",
      customerEmail: "team@example.invalid",
      customerName: "Team Customer",
    })
    expect(team.ok && team.data.license.serverLimit).toBe(3)
  })

  it("gives a yearly order a longer term than a monthly one", async () => {
    const monthly = await issueLicense({
      externalOrderId: nextOrderId("m"),
      plan: "pro",
      billingInterval: "monthly",
      customerEmail: "m@example.invalid",
      customerName: "M",
    })
    const yearly = await issueLicense({
      externalOrderId: nextOrderId("y"),
      plan: "pro",
      billingInterval: "yearly",
      customerEmail: "y@example.invalid",
      customerName: "Y",
    })
    if (!monthly.ok || !yearly.ok) throw new Error("issue failed")
    const m = new Date(monthly.data.license.expiresAt!).getTime()
    const y = new Date(yearly.data.license.expiresAt!).getTime()
    expect(y).toBeGreaterThan(m)
  })

  it("upserts the customer rather than duplicating them across orders", async () => {
    await issuePro("same@example.invalid")
    await issuePro("same@example.invalid")
    const customers = await prisma.customer.findMany({ where: { email: "same@example.invalid" } })
    expect(customers).toHaveLength(1)
  })

  it("is idempotent: replaying an order returns the same license, not a second one", async () => {
    const orderId = nextOrderId("idem")
    const input = {
      externalOrderId: orderId,
      plan: "pro" as const,
      billingInterval: "monthly" as const,
      customerEmail: "idem@example.invalid",
      customerName: "Idem",
    }

    const first = await issueLicense(input)
    const second = await issueLicense(input)
    if (!first.ok || !second.ok) throw new Error("issue failed")

    expect(first.data.created).toBe(true)
    expect(second.data.created).toBe(false)
    expect(second.data.license.id).toBe(first.data.license.id)
    // The key is returned exactly once — a replay cannot be used to recover it.
    expect(second.data.licenseKey).toBeNull()

    expect(await prisma.license.count({ where: { externalOrderId: orderId } })).toBe(1)
  })

  it("survives concurrent identical orders without minting twice", async () => {
    const input = {
      externalOrderId: nextOrderId("race"),
      plan: "pro" as const,
      billingInterval: "monthly" as const,
      customerEmail: "race@example.invalid",
      customerName: "Race",
    }
    const results = await Promise.all([
      issueLicense(input),
      issueLicense(input),
      issueLicense(input),
    ])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(
      await prisma.license.count({ where: { externalOrderId: input.externalOrderId } }),
    ).toBe(1)
  })

  it("finds a license by the order that paid for it", async () => {
    const orderId = nextOrderId("lookup")
    await issueLicense({
      externalOrderId: orderId,
      plan: "pro",
      billingInterval: "monthly",
      customerEmail: "lookup@example.invalid",
      customerName: "Lookup",
    })
    const found = await findLicenseByOrder(orderId)
    expect(found.ok && found.data.found).toBe(true)

    const missing = await findLicenseByOrder("no-such-order")
    expect(missing.ok && missing.data.found).toBe(false)
  })
})

describe("activation and server limits", () => {
  it("activates an instance and returns a token bound to it", async () => {
    const issued = await issuePro()
    const result = await activateLicense({
      licenseKey: issued.licenseKey!,
      instanceId: "instance-a",
      instanceName: "A",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const payload = verify(result.data.token, "instance-a")
    expect(payload?.plan).toBe("pro")
    expect(payload?.status).toBe("active")
    // A token minted for one instance must not verify as another's.
    expect(verify(result.data.token, "instance-b")).toBeNull()
  })

  it("rejects a key that does not exist", async () => {
    const result = await activateLicense({
      licenseKey: "arc_pro_ffffffffffffffffffffffffffffffff",
      instanceId: "instance-a",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("INVALID_LICENSE_KEY")
  })

  it("holds Pro to a single server", async () => {
    const issued = await issuePro()
    const first = await activateLicense({ licenseKey: issued.licenseKey!, instanceId: "one" })
    const second = await activateLicense({ licenseKey: issued.licenseKey!, instanceId: "two" })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.code).toBe("SERVER_LIMIT_REACHED")
  })

  it("allows Team exactly three servers", async () => {
    const team = await issueLicense({
      externalOrderId: nextOrderId("team3"),
      plan: "team",
      billingInterval: "monthly",
      customerEmail: "team3@example.invalid",
      customerName: "Team",
    })
    if (!team.ok) throw new Error("issue failed")
    const key = team.data.licenseKey!

    for (const id of ["t1", "t2", "t3"]) {
      expect((await activateLicense({ licenseKey: key, instanceId: id })).ok).toBe(true)
    }
    const fourth = await activateLicense({ licenseKey: key, instanceId: "t4" })
    expect(fourth.ok).toBe(false)
    if (!fourth.ok) expect(fourth.code).toBe("SERVER_LIMIT_REACHED")
  })

  it("re-activating the same instance does not consume another slot", async () => {
    const issued = await issuePro()
    await activateLicense({ licenseKey: issued.licenseKey!, instanceId: "same" })
    const again = await activateLicense({ licenseKey: issued.licenseKey!, instanceId: "same" })
    expect(again.ok).toBe(true)
    if (again.ok) expect(again.data.servers.activated).toBe(1)
  })

  it("deactivating releases the slot for a different server", async () => {
    const issued = await issuePro()
    await activateLicense({ licenseKey: issued.licenseKey!, instanceId: "old-box" })

    const blocked = await activateLicense({ licenseKey: issued.licenseKey!, instanceId: "new-box" })
    expect(blocked.ok).toBe(false)

    const released = await deactivateLicense({
      licenseKey: issued.licenseKey!,
      instanceId: "old-box",
    })
    expect(released.ok && released.data.deactivated).toBe(true)

    const allowed = await activateLicense({ licenseKey: issued.licenseKey!, instanceId: "new-box" })
    expect(allowed.ok).toBe(true)
  })

  it("releases a slot from the vendor side too", async () => {
    const issued = await issuePro()
    await activateLicense({ licenseKey: issued.licenseKey!, instanceId: "stranded" })
    const result = await deactivateByLicenseId({
      licenseId: issued.license.id,
      instanceId: "stranded",
    })
    expect(result.ok).toBe(true)

    const reuse = await activateLicense({ licenseKey: issued.licenseKey!, instanceId: "fresh" })
    expect(reuse.ok).toBe(true)
  })
})

describe("refresh", () => {
  it("reports an active license and advances the check-in time", async () => {
    const issued = await issuePro()
    const activated = await activateLicense({
      licenseKey: issued.licenseKey!,
      instanceId: "refresher",
    })
    if (!activated.ok) throw new Error("activate failed")
    const before = activated.data.activation.lastCheckInAt

    await new Promise((resolve) => setTimeout(resolve, 10))
    const refreshed = await refreshLicense({
      licenseKey: issued.licenseKey!,
      instanceId: "refresher",
    })
    expect(refreshed.ok).toBe(true)
    if (!refreshed.ok) return

    expect(refreshed.data.payload.status).toBe("active")
    expect(
      new Date(refreshed.data.activation.lastCheckInAt!).getTime(),
    ).toBeGreaterThanOrEqual(new Date(before!).getTime())
  })

  it("refuses to refresh an instance that was never activated", async () => {
    const issued = await issuePro()
    const result = await refreshLicense({
      licenseKey: issued.licenseKey!,
      instanceId: "never-activated",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("NOT_ACTIVATED")
  })

  it("accepts the signed token in place of the key", async () => {
    const issued = await issuePro()
    const activated = await activateLicense({
      licenseKey: issued.licenseKey!,
      instanceId: "by-token",
    })
    if (!activated.ok) throw new Error("activate failed")

    const refreshed = await refreshLicense({
      token: activated.data.token,
      instanceId: "by-token",
    })
    expect(refreshed.ok).toBe(true)
  })
})

describe("revocation", () => {
  it("tells a checked-in instance that its license was revoked", async () => {
    const issued = await issuePro()
    await activateLicense({ licenseKey: issued.licenseKey!, instanceId: "revoked-box" })

    await revokeLicense(issued.licenseKey!)

    const refreshed = await refreshLicense({
      licenseKey: issued.licenseKey!,
      instanceId: "revoked-box",
    })
    expect(refreshed.ok).toBe(true)
    if (refreshed.ok) expect(refreshed.data.payload.status).toBe("revoked")
  })

  it("blocks a revoked key from activating anywhere new", async () => {
    const issued = await issuePro()
    await revokeLicense(issued.licenseKey!)

    const result = await activateLicense({
      licenseKey: issued.licenseKey!,
      instanceId: "somewhere-else",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("LICENSE_REVOKED")
  })
})

describe("expiry and grace", () => {
  async function issueExpired(daysPastExpiry: number, graceDays: number) {
    const issued = await issuePro(`grace-${daysPastExpiry}-${graceDays}@example.invalid`)
    await activateLicense({ licenseKey: issued.licenseKey!, instanceId: "aging-box" })
    await prisma.license.update({
      where: { id: issued.license.id },
      data: {
        expiresAt: new Date(Date.now() - daysPastExpiry * 86_400_000),
        graceDays,
      },
    })
    return issued
  }

  it("keeps a just-expired license in grace", async () => {
    const issued = await issueExpired(1, 7)
    const refreshed = await refreshLicense({
      licenseKey: issued.licenseKey!,
      instanceId: "aging-box",
    })
    expect(refreshed.ok).toBe(true)
    if (refreshed.ok) expect(refreshed.data.payload.status).toBe("grace")
  })

  it("marks it expired once grace has run out", async () => {
    const issued = await issueExpired(30, 7)
    const refreshed = await refreshLicense({
      licenseKey: issued.licenseKey!,
      instanceId: "aging-box",
    })
    expect(refreshed.ok).toBe(true)
    if (refreshed.ok) expect(refreshed.data.payload.status).toBe("expired")
  })

  it("refuses a fresh activation once grace has run out", async () => {
    const issued = await issueExpired(30, 7)
    const result = await activateLicense({
      licenseKey: issued.licenseKey!,
      instanceId: "brand-new-box",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe("LICENSE_EXPIRED")
  })

  it("never expires a free license", async () => {
    const free = await issueLicense({
      externalOrderId: nextOrderId("free"),
      plan: "free",
      billingInterval: "monthly",
      customerEmail: "free@example.invalid",
      customerName: "Free",
    })
    expect(free.ok && free.data.license.expiresAt).toBeNull()
  })
})

describe("status endpoints and the PII boundary", () => {
  it("tells an instance about its own activation and nothing about the customer", async () => {
    const issued = await issuePro("private@example.invalid")
    await activateLicense({
      licenseKey: issued.licenseKey!,
      instanceId: "mine",
      hostname: "my-host",
    })

    const status = await getInstanceLicenseStatus({
      licenseKey: issued.licenseKey!,
      instanceId: "mine",
    })
    expect(status.ok).toBe(true)
    if (!status.ok) return

    const serialized = JSON.stringify(status.data)
    expect(serialized).not.toContain("private@example.invalid")
    expect(serialized).not.toContain("Pro Customer")
    expect(status.data.thisInstance.activated).toBe(true)
    expect(status.data.license.plan).toBe("pro")
  })

  it("does not reveal another server's hostname to an instance", async () => {
    const team = await issueLicense({
      externalOrderId: nextOrderId("pii"),
      plan: "team",
      billingInterval: "monthly",
      customerEmail: "fleet@example.invalid",
      customerName: "Fleet",
    })
    if (!team.ok) throw new Error("issue failed")
    const key = team.data.licenseKey!

    await activateLicense({ licenseKey: key, instanceId: "box-1", hostname: "secret-host-one" })
    await activateLicense({ licenseKey: key, instanceId: "box-2", hostname: "secret-host-two" })

    const status = await getInstanceLicenseStatus({ licenseKey: key, instanceId: "box-1" })
    expect(status.ok).toBe(true)
    if (!status.ok) return

    const serialized = JSON.stringify(status.data)
    expect(serialized).not.toContain("secret-host-two")
    // The seat count is legitimate — it is what the customer bought.
    expect(status.data.servers.activated).toBe(2)
  })

  it("still gives the vendor-side lookup full detail", async () => {
    const issued = await issuePro("vendor-view@example.invalid")
    const status = await getLicenseStatus({ licenseKey: issued.licenseKey! })
    expect(status.ok).toBe(true)
    if (status.ok) expect(status.data.customer?.email).toBe("vendor-view@example.invalid")
  })
})

describe("the development demo path", () => {
  it("is still distinguishable from a purchased key", async () => {
    const demo = await createDemoLicense({ plan: "pro" })
    expect(demo.licenseKey).toMatch(/^arc_demo_pro_/)
    expect(isLicensePlanId(demo.license.plan)).toBe(true)
  })
})
