import {
  buildHostedTokenPayload,
  generateHostedLicenseKey,
  hashLicenseKey,
  isLicensePlanId,
  keyDisplayPrefix,
  normalizeLicenseKey,
  serverLimitNumber,
  signHostedLicenseToken,
  type HostedLicenseTokenPayload,
  type LicensePlanId,
  type LicenseServerActivateResponse,
  type LicenseServerDemoResponse,
  type LicenseServerStatusResponse,
  verifyHostedLicenseToken,
} from "@arciin/config"

import { licenseServerConfig } from "../config.js"
import { prisma } from "../db.js"

function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

function graceUntilFor(expiresAt: Date | null, graceDays: number): Date | null {
  if (!expiresAt) return null
  return new Date(expiresAt.getTime() + graceDays * 24 * 60 * 60 * 1000)
}

function effectiveLicenseStatus(
  status: string,
  expiresAt: Date | null,
  graceDays: number,
  now = new Date(),
): HostedLicenseTokenPayload["status"] {
  if (status === "revoked") return "revoked"
  if (status === "inactive") return "inactive"
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    const grace = graceUntilFor(expiresAt, graceDays)
    if (grace && grace.getTime() > now.getTime()) return "grace"
    return "expired"
  }
  return "active"
}

async function countActiveActivations(licenseId: string): Promise<number> {
  return prisma.activation.count({
    where: { licenseId, deactivatedAt: null },
  })
}

export async function createDemoLicense(input: {
  plan: LicensePlanId
  customerName?: string
  customerEmail?: string
  durationDays?: number
  serverLimit?: number
  graceDays?: number
}): Promise<LicenseServerDemoResponse> {
  const plan = input.plan
  const durationDays = Math.min(Math.max(input.durationDays ?? 30, 1), 3650)
  const graceDays = Math.min(Math.max(input.graceDays ?? 7, 0), 90)
  const serverLimit = serverLimitNumber(plan, input.serverLimit)

  const email = (input.customerEmail ?? "demo@arciin.local").trim().toLowerCase()
  const name = (input.customerName ?? "Demo Customer").trim() || "Demo Customer"

  const customer = await prisma.customer.upsert({
    where: { email },
    create: { name, email },
    update: { name },
  })

  const licenseKey = generateHostedLicenseKey(plan, "demo")
  const keyHash = hashLicenseKey(licenseKey)
  const keyPrefix = keyDisplayPrefix(licenseKey)
  const now = new Date()
  const expiresAt =
    plan === "free" ? null : new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000)

  const license = await prisma.license.create({
    data: {
      customerId: customer.id,
      keyPrefix,
      keyHash,
      demoPlainKey: licenseKey, // prototype only — account portal copy
      plan,
      status: "active",
      serverLimit,
      expiresAt,
      graceDays,
    },
  })

  return {
    licenseKey,
    license: {
      id: license.id,
      plan: plan,
      status: license.status,
      serverLimit: license.serverLimit,
      expiresAt: toIso(license.expiresAt),
      graceDays: license.graceDays,
      keyPrefix: license.keyPrefix,
      createdAt: license.createdAt.toISOString(),
    },
    customer: {
      id: customer.id,
      name: customer.name,
      email: customer.email,
    },
  }
}

export type ActivateInput = {
  licenseKey: string
  instanceId: string
  instanceName?: string
  version?: string
  hostname?: string
}

export type OpsResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; status: number }

export async function activateLicense(
  input: ActivateInput,
): Promise<OpsResult<LicenseServerActivateResponse>> {
  const instanceId = input.instanceId.trim()
  if (!instanceId) {
    return { ok: false, code: "INSTANCE_ID_REQUIRED", message: "instanceId is required.", status: 400 }
  }

  const keyHash = hashLicenseKey(input.licenseKey)
  const license = await prisma.license.findUnique({ where: { keyHash } })
  if (!license) {
    return {
      ok: false,
      code: "INVALID_LICENSE_KEY",
      message: "License key not found.",
      status: 400,
    }
  }

  const now = new Date()
  const eff = effectiveLicenseStatus(license.status, license.expiresAt, license.graceDays, now)

  if (license.status === "revoked" || eff === "revoked") {
    return {
      ok: false,
      code: "LICENSE_REVOKED",
      message: "This license has been revoked.",
      status: 403,
    }
  }
  if (license.status === "inactive") {
    return {
      ok: false,
      code: "LICENSE_INACTIVE",
      message: "This license is inactive.",
      status: 403,
    }
  }
  if (eff === "expired") {
    return {
      ok: false,
      code: "LICENSE_EXPIRED",
      message: "This license has expired (including grace period).",
      status: 403,
    }
  }

  if (!isLicensePlanId(license.plan)) {
    return {
      ok: false,
      code: "INVALID_PLAN",
      message: "License plan is invalid.",
      status: 500,
    }
  }

  const existing = await prisma.activation.findUnique({
    where: {
      licenseId_instanceId: { licenseId: license.id, instanceId },
    },
  })

  if (!existing || existing.deactivatedAt) {
    const activeCount = await countActiveActivations(license.id)
    // Reactivating same instance after deactivate is ok; only block new slots
    const needsSlot = !existing || existing.deactivatedAt !== null
    if (needsSlot && activeCount >= license.serverLimit && !existing) {
      return {
        ok: false,
        code: "SERVER_LIMIT_REACHED",
        message: `Server limit reached (${license.serverLimit}). Deactivate another instance first.`,
        status: 403,
      }
    }
    // If re-activating a previously deactivated activation on this instance, always allow
    if (!existing && activeCount >= license.serverLimit) {
      return {
        ok: false,
        code: "SERVER_LIMIT_REACHED",
        message: `Server limit reached (${license.serverLimit}). Deactivate another instance first.`,
        status: 403,
      }
    }
  }

  const activation = existing
    ? await prisma.activation.update({
        where: { id: existing.id },
        data: {
          instanceName: input.instanceName ?? existing.instanceName,
          instanceVersion: input.version ?? existing.instanceVersion,
          hostname: input.hostname ?? existing.hostname,
          lastCheckInAt: now,
          deactivatedAt: null,
          activatedAt: existing.deactivatedAt ? now : existing.activatedAt,
        },
      })
    : await prisma.activation.create({
        data: {
          licenseId: license.id,
          instanceId,
          instanceName: input.instanceName ?? null,
          instanceVersion: input.version ?? null,
          hostname: input.hostname ?? null,
          lastCheckInAt: now,
          activatedAt: now,
        },
      })

  // If license was marked expired in DB but still in grace, keep token status grace
  const tokenStatus = eff === "grace" ? "grace" : "active"
  const graceUntil = graceUntilFor(license.expiresAt, license.graceDays)
  const payload = buildHostedTokenPayload({
    licenseId: license.id,
    plan: license.plan,
    status: tokenStatus,
    instanceId,
    serverLimit: license.serverLimit,
    keyPrefix: license.keyPrefix,
    expiresAt: license.expiresAt,
    graceUntil,
    activationId: activation.id,
  })
  const token = signHostedLicenseToken(payload, licenseServerConfig.LICENSE_SIGNING_SECRET)
  const activated = await countActiveActivations(license.id)

  return {
    ok: true,
    data: {
      token,
      payload,
      license: {
        id: license.id,
        plan: license.plan,
        status: license.status,
        serverLimit: license.serverLimit,
        expiresAt: toIso(license.expiresAt),
        graceDays: license.graceDays,
        keyPrefix: license.keyPrefix,
      },
      activation: {
        id: activation.id,
        instanceId: activation.instanceId,
        instanceName: activation.instanceName,
        lastCheckInAt: toIso(activation.lastCheckInAt),
        activatedAt: activation.activatedAt.toISOString(),
      },
      servers: {
        activated,
        limit: license.serverLimit,
      },
    },
  }
}

export async function refreshLicense(input: {
  token?: string
  licenseKey?: string
  instanceId?: string
}): Promise<OpsResult<LicenseServerActivateResponse>> {
  let licenseId: string | null = null
  let instanceId: string | null = input.instanceId?.trim() || null
  let keyPrefix = ""

  if (input.token) {
    const payload = verifyHostedLicenseToken(
      input.token,
      licenseServerConfig.LICENSE_SIGNING_SECRET,
      instanceId ? { expectedInstanceId: instanceId } : undefined,
    )
    if (!payload) {
      return {
        ok: false,
        code: "INVALID_TOKEN",
        message: "Signed license token is invalid.",
        status: 400,
      }
    }
    licenseId = payload.licenseId
    instanceId = payload.instanceId
    keyPrefix = payload.keyPrefix
  } else if (input.licenseKey && instanceId) {
    const license = await prisma.license.findUnique({
      where: { keyHash: hashLicenseKey(input.licenseKey) },
    })
    if (!license) {
      return {
        ok: false,
        code: "INVALID_LICENSE_KEY",
        message: "License key not found.",
        status: 400,
      }
    }
    licenseId = license.id
    keyPrefix = license.keyPrefix
  } else {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Provide a signed token, or licenseKey + instanceId.",
      status: 400,
    }
  }

  if (!licenseId || !instanceId) {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Could not resolve license and instance.",
      status: 400,
    }
  }

  const license = await prisma.license.findUnique({ where: { id: licenseId } })
  if (!license) {
    return {
      ok: false,
      code: "LICENSE_NOT_FOUND",
      message: "License no longer exists.",
      status: 404,
    }
  }

  const activation = await prisma.activation.findUnique({
    where: {
      licenseId_instanceId: { licenseId: license.id, instanceId },
    },
  })

  if (!activation || activation.deactivatedAt) {
    return {
      ok: false,
      code: "NOT_ACTIVATED",
      message: "This instance is not activated for this license.",
      status: 403,
    }
  }

  const now = new Date()
  const eff = effectiveLicenseStatus(license.status, license.expiresAt, license.graceDays, now)

  if (license.status === "revoked" || eff === "revoked") {
    // Still update check-in so dashboards show last contact, then return revoked token
    await prisma.activation.update({
      where: { id: activation.id },
      data: { lastCheckInAt: now },
    })
    const graceUntil = graceUntilFor(license.expiresAt, license.graceDays)
    if (!isLicensePlanId(license.plan)) {
      return { ok: false, code: "INVALID_PLAN", message: "Invalid plan.", status: 500 }
    }
    const payload = buildHostedTokenPayload({
      licenseId: license.id,
      plan: license.plan,
      status: "revoked",
      instanceId,
      serverLimit: license.serverLimit,
      keyPrefix: license.keyPrefix || keyPrefix,
      expiresAt: license.expiresAt,
      graceUntil,
      activationId: activation.id,
    })
    // For revoked: features should be free on client — still return token with revoked status
    const token = signHostedLicenseToken(
      { ...payload, features: [...payload.features] },
      licenseServerConfig.LICENSE_SIGNING_SECRET,
    )
    return {
      ok: true,
      data: {
        token,
        payload: { ...payload, status: "revoked" },
        license: {
          id: license.id,
          plan: license.plan,
          status: "revoked",
          serverLimit: license.serverLimit,
          expiresAt: toIso(license.expiresAt),
          graceDays: license.graceDays,
          keyPrefix: license.keyPrefix,
        },
        activation: {
          id: activation.id,
          instanceId: activation.instanceId,
          instanceName: activation.instanceName,
          lastCheckInAt: now.toISOString(),
          activatedAt: activation.activatedAt.toISOString(),
        },
        servers: {
          activated: await countActiveActivations(license.id),
          limit: license.serverLimit,
        },
      },
    }
  }

  await prisma.activation.update({
    where: { id: activation.id },
    data: { lastCheckInAt: now },
  })

  if (!isLicensePlanId(license.plan)) {
    return { ok: false, code: "INVALID_PLAN", message: "Invalid plan.", status: 500 }
  }

  let tokenStatus: HostedLicenseTokenPayload["status"] = "active"
  if (eff === "expired") tokenStatus = "expired"
  else if (eff === "grace") tokenStatus = "grace"
  else if (eff === "inactive") tokenStatus = "inactive"

  const graceUntil = graceUntilFor(license.expiresAt, license.graceDays)
  const payload = buildHostedTokenPayload({
    licenseId: license.id,
    plan: license.plan,
    status: tokenStatus,
    instanceId,
    serverLimit: license.serverLimit,
    keyPrefix: license.keyPrefix || keyPrefix,
    expiresAt: license.expiresAt,
    graceUntil,
    activationId: activation.id,
  })
  const token = signHostedLicenseToken(payload, licenseServerConfig.LICENSE_SIGNING_SECRET)

  return {
    ok: true,
    data: {
      token,
      payload,
      license: {
        id: license.id,
        plan: license.plan,
        status: license.status,
        serverLimit: license.serverLimit,
        expiresAt: toIso(license.expiresAt),
        graceDays: license.graceDays,
        keyPrefix: license.keyPrefix,
      },
      activation: {
        id: activation.id,
        instanceId: activation.instanceId,
        instanceName: activation.instanceName,
        lastCheckInAt: now.toISOString(),
        activatedAt: activation.activatedAt.toISOString(),
      },
      servers: {
        activated: await countActiveActivations(license.id),
        limit: license.serverLimit,
      },
    },
  }
}

export async function deactivateLicense(input: {
  licenseKey?: string
  token?: string
  instanceId: string
}): Promise<OpsResult<{ deactivated: boolean; activationId: string | null }>> {
  const instanceId = input.instanceId.trim()
  if (!instanceId) {
    return { ok: false, code: "INSTANCE_ID_REQUIRED", message: "instanceId is required.", status: 400 }
  }

  let licenseId: string | null = null

  if (input.token) {
    const payload = verifyHostedLicenseToken(input.token, licenseServerConfig.LICENSE_SIGNING_SECRET, {
      expectedInstanceId: instanceId,
    })
    if (!payload) {
      return { ok: false, code: "INVALID_TOKEN", message: "Invalid signed token.", status: 400 }
    }
    licenseId = payload.licenseId
  } else if (input.licenseKey) {
    const license = await prisma.license.findUnique({
      where: { keyHash: hashLicenseKey(input.licenseKey) },
    })
    if (!license) {
      return { ok: false, code: "INVALID_LICENSE_KEY", message: "License key not found.", status: 400 }
    }
    licenseId = license.id
  } else {
    return {
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Provide licenseKey or token with instanceId.",
      status: 400,
    }
  }

  const activation = await prisma.activation.findUnique({
    where: {
      licenseId_instanceId: { licenseId: licenseId!, instanceId },
    },
  })

  if (!activation || activation.deactivatedAt) {
    return {
      ok: true,
      data: { deactivated: false, activationId: activation?.id ?? null },
    }
  }

  await prisma.activation.update({
    where: { id: activation.id },
    data: { deactivatedAt: new Date(), lastCheckInAt: new Date() },
  })

  return {
    ok: true,
    data: { deactivated: true, activationId: activation.id },
  }
}

export async function getLicenseStatus(input: {
  licenseKey?: string
  activationId?: string
  licenseId?: string
}): Promise<OpsResult<LicenseServerStatusResponse>> {
  let license =
    input.licenseKey
      ? await prisma.license.findUnique({
          where: { keyHash: hashLicenseKey(input.licenseKey) },
          include: { customer: true, activations: { orderBy: { activatedAt: "desc" } } },
        })
      : null

  if (!license && input.activationId) {
    const act = await prisma.activation.findUnique({
      where: { id: input.activationId },
      include: {
        license: { include: { customer: true, activations: { orderBy: { activatedAt: "desc" } } } },
      },
    })
    license = act?.license ?? null
  }

  if (!license && input.licenseId) {
    license = await prisma.license.findUnique({
      where: { id: input.licenseId },
      include: { customer: true, activations: { orderBy: { activatedAt: "desc" } } },
    })
  }

  if (!license) {
    return {
      ok: false,
      code: "LICENSE_NOT_FOUND",
      message: "License not found.",
      status: 404,
    }
  }

  if (!isLicensePlanId(license.plan)) {
    return { ok: false, code: "INVALID_PLAN", message: "Invalid plan.", status: 500 }
  }

  const activated = license.activations.filter((a) => !a.deactivatedAt).length

  return {
    ok: true,
    data: {
      license: {
        id: license.id,
        plan: license.plan,
        status: license.status,
        serverLimit: license.serverLimit,
        expiresAt: toIso(license.expiresAt),
        graceDays: license.graceDays,
        keyPrefix: license.keyPrefix,
        createdAt: license.createdAt.toISOString(),
      },
      customer: license.customer
        ? {
            id: license.customer.id,
            name: license.customer.name,
            email: license.customer.email,
          }
        : null,
      activations: license.activations.map((a) => ({
        id: a.id,
        instanceId: a.instanceId,
        instanceName: a.instanceName,
        instanceVersion: a.instanceVersion,
        hostname: a.hostname,
        lastCheckInAt: toIso(a.lastCheckInAt),
        activatedAt: a.activatedAt.toISOString(),
        deactivatedAt: toIso(a.deactivatedAt),
        active: !a.deactivatedAt,
      })),
      servers: {
        activated,
        limit: license.serverLimit,
      },
    },
  }
}

/** Admin/dev: revoke a license by key. */
export async function revokeLicense(licenseKey: string): Promise<OpsResult<{ id: string }>> {
  const license = await prisma.license.findUnique({
    where: { keyHash: hashLicenseKey(licenseKey) },
  })
  if (!license) {
    return { ok: false, code: "LICENSE_NOT_FOUND", message: "License not found.", status: 404 }
  }
  await prisma.license.update({
    where: { id: license.id },
    data: { status: "revoked" },
  })
  return { ok: true, data: { id: license.id } }
}

export function normalizeIncomingKey(raw: string): string {
  return normalizeLicenseKey(raw)
}

export type AccountLicenseRow = {
  id: string
  plan: LicensePlanId
  status: string
  keyPrefix: string
  /** Demo only — full key when stored */
  licenseKey: string | null
  serverLimit: number
  activatedServers: number
  expiresAt: string | null
  graceDays: number
  createdAt: string
  lastCheckInAt: string | null
  activations: Array<{
    id: string
    instanceId: string
    instanceName: string | null
    instanceVersion: string | null
    hostname: string | null
    lastCheckInAt: string | null
    activatedAt: string
    deactivatedAt: string | null
    active: boolean
  }>
}

export type AccountOverview = {
  demoMode: true
  customer: {
    id: string
    name: string
    email: string
    createdAt: string
  }
  summary: {
    licenseCount: number
    activeLicenses: number
    activatedServers: number
    primaryPlan: LicensePlanId | "none"
    nextRenewalAt: string | null
    backupStatus: "not_connected"
  }
  licenses: AccountLicenseRow[]
  activations: Array<{
    id: string
    licenseId: string
    plan: LicensePlanId
    instanceId: string
    instanceName: string | null
    instanceVersion: string | null
    hostname: string | null
    lastCheckInAt: string | null
    activatedAt: string
    deactivatedAt: string | null
    active: boolean
    licenseKeyPrefix: string
  }>
}

/** Account portal: list licenses + activations for a demo customer email. */
export async function getAccountOverview(input: {
  email?: string
}): Promise<OpsResult<AccountOverview>> {
  const email = (input.email ?? "you@yourserver.com").trim().toLowerCase()

  let customer = await prisma.customer.findUnique({ where: { email } })
  if (!customer) {
    // Bootstrap empty demo customer so the portal always has an identity
    customer = await prisma.customer.create({
      data: {
        email,
        name: email === "you@yourserver.com" ? "Demo Customer" : email.split("@")[0] || "Customer",
      },
    })
  }

  const licenses = await prisma.license.findMany({
    where: { customerId: customer.id },
    include: {
      activations: { orderBy: { activatedAt: "desc" } },
    },
    orderBy: { createdAt: "desc" },
  })

  const rows: AccountLicenseRow[] = []
  const activations: AccountOverview["activations"] = []

  for (const lic of licenses) {
    if (!isLicensePlanId(lic.plan)) continue
    const activeActs = lic.activations.filter((a) => !a.deactivatedAt)
    const lastCheckIn = lic.activations
      .map((a) => a.lastCheckInAt)
      .filter(Boolean)
      .sort((a, b) => (b!.getTime() - a!.getTime()))[0]

    rows.push({
      id: lic.id,
      plan: lic.plan,
      status: lic.status,
      keyPrefix: lic.keyPrefix,
      licenseKey: lic.demoPlainKey,
      serverLimit: lic.serverLimit,
      activatedServers: activeActs.length,
      expiresAt: toIso(lic.expiresAt),
      graceDays: lic.graceDays,
      createdAt: lic.createdAt.toISOString(),
      lastCheckInAt: toIso(lastCheckIn ?? null),
      activations: lic.activations.map((a) => ({
        id: a.id,
        instanceId: a.instanceId,
        instanceName: a.instanceName,
        instanceVersion: a.instanceVersion,
        hostname: a.hostname,
        lastCheckInAt: toIso(a.lastCheckInAt),
        activatedAt: a.activatedAt.toISOString(),
        deactivatedAt: toIso(a.deactivatedAt),
        active: !a.deactivatedAt,
      })),
    })

    for (const a of lic.activations) {
      activations.push({
        id: a.id,
        licenseId: lic.id,
        plan: lic.plan,
        instanceId: a.instanceId,
        instanceName: a.instanceName,
        instanceVersion: a.instanceVersion,
        hostname: a.hostname,
        lastCheckInAt: toIso(a.lastCheckInAt),
        activatedAt: a.activatedAt.toISOString(),
        deactivatedAt: toIso(a.deactivatedAt),
        active: !a.deactivatedAt,
        licenseKeyPrefix: lic.keyPrefix,
      })
    }
  }

  const activeLicenses = rows.filter((r) => r.status === "active")
  const primary =
    activeLicenses.find((r) => r.plan === "business") ??
    activeLicenses.find((r) => r.plan === "team") ??
    activeLicenses.find((r) => r.plan === "pro") ??
    activeLicenses.find((r) => r.plan === "free") ??
    null

  const renewals = activeLicenses
    .map((r) => r.expiresAt)
    .filter((x): x is string => Boolean(x))
    .sort()

  return {
    ok: true,
    data: {
      demoMode: true,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        createdAt: customer.createdAt.toISOString(),
      },
      summary: {
        licenseCount: rows.length,
        activeLicenses: activeLicenses.length,
        activatedServers: activations.filter((a) => a.active).length,
        primaryPlan: primary?.plan ?? "none",
        nextRenewalAt: renewals[0] ?? null,
        backupStatus: "not_connected",
      },
      licenses: rows,
      activations: activations.sort((a, b) =>
        a.active === b.active ? b.activatedAt.localeCompare(a.activatedAt) : a.active ? -1 : 1,
      ),
    },
  }
}

/** Deactivate by license id + instance (account portal uses demoPlainKey under the hood). */
export async function deactivateByLicenseId(input: {
  licenseId: string
  instanceId: string
}): Promise<OpsResult<{ deactivated: boolean; activationId: string | null }>> {
  const license = await prisma.license.findUnique({ where: { id: input.licenseId } })
  if (!license) {
    return { ok: false, code: "LICENSE_NOT_FOUND", message: "License not found.", status: 404 }
  }
  if (license.demoPlainKey) {
    return deactivateLicense({
      licenseKey: license.demoPlainKey,
      instanceId: input.instanceId,
    })
  }
  // Fallback: direct activation update without key
  const activation = await prisma.activation.findUnique({
    where: {
      licenseId_instanceId: {
        licenseId: input.licenseId,
        instanceId: input.instanceId.trim(),
      },
    },
  })
  if (!activation || activation.deactivatedAt) {
    return { ok: true, data: { deactivated: false, activationId: activation?.id ?? null } }
  }
  await prisma.activation.update({
    where: { id: activation.id },
    data: { deactivatedAt: new Date(), lastCheckInAt: new Date() },
  })
  return { ok: true, data: { deactivated: true, activationId: activation.id } }
}

export async function revokeLicenseById(
  licenseId: string,
): Promise<OpsResult<{ id: string }>> {
  const license = await prisma.license.findUnique({ where: { id: licenseId } })
  if (!license) {
    return { ok: false, code: "LICENSE_NOT_FOUND", message: "License not found.", status: 404 }
  }
  await prisma.license.update({
    where: { id: license.id },
    data: { status: "revoked" },
  })
  return { ok: true, data: { id: license.id } }
}
