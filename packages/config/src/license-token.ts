/**
 * Hosted license token format (license.arciin.com prototype).
 * Signed by the license server; verified by self-hosted instances.
 *
 * Format: arclic.v2.<base64url(json)>.<base64url(hmac-sha256)>
 */

import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { featuresForPlan, type LicenseFeatureId, type LicensePlanId, isLicensePlanId } from "./entitlements"
import { keyDisplayPrefix, normalizeLicenseKey } from "./license"

export const LICENSE_TOKEN_PREFIX = "arclic"
export const LICENSE_TOKEN_VERSION = "v2"

/** Payload embedded in hosted license tokens. */
export type HostedLicenseTokenPayload = {
  v: 2
  licenseId: string
  plan: LicensePlanId
  status: "active" | "inactive" | "expired" | "revoked" | "grace"
  instanceId: string
  features: LicenseFeatureId[]
  serverLimit: number
  keyPrefix: string
  issuedAt: string
  expiresAt: string | null
  graceUntil: string | null
  /** Customer-facing activation id on the license server. */
  activationId?: string
}

export function defaultLicenseSigningSecret(): string {
  return "arciin-dev-license-signing-secret-change-me"
}

export function hashLicenseKey(rawKey: string): string {
  return createHash("sha256").update(normalizeLicenseKey(rawKey), "utf8").digest("hex")
}

/** Customer-facing key: arc_lic_pro_<random> (or arc_demo_ for portal branding). */
export function generateHostedLicenseKey(plan: LicensePlanId, kind: "lic" | "demo" = "lic"): string {
  const suffix = randomBytes(12).toString("hex")
  return `arc_${kind}_${plan}_${suffix}`
}

export function serverLimitNumber(plan: LicensePlanId, override?: number): number {
  if (typeof override === "number" && override > 0) return override
  if (plan === "business") return 99
  if (plan === "team") return 3
  return 1
}

export function signHostedLicenseToken(
  payload: HostedLicenseTokenPayload,
  secret: string,
): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const sig = createHmac("sha256", secret).update(body).digest("base64url")
  return `${LICENSE_TOKEN_PREFIX}.${LICENSE_TOKEN_VERSION}.${body}.${sig}`
}

export function verifyHostedLicenseToken(
  token: string,
  secret: string,
  options?: { expectedInstanceId?: string },
): HostedLicenseTokenPayload | null {
  const parts = token.split(".")
  if (
    parts.length !== 4 ||
    parts[0] !== LICENSE_TOKEN_PREFIX ||
    parts[1] !== LICENSE_TOKEN_VERSION
  ) {
    return null
  }
  const body = parts[2]!
  const sig = parts[3]!
  const expected = createHmac("sha256", secret).update(body).digest("base64url")
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as HostedLicenseTokenPayload
    if (payload.v !== 2 || !isLicensePlanId(payload.plan)) return null
    if (options?.expectedInstanceId && payload.instanceId !== options.expectedInstanceId) {
      return null
    }
    if (!Array.isArray(payload.features)) return null
    return payload
  } catch {
    return null
  }
}

export function buildHostedTokenPayload(input: {
  licenseId: string
  plan: LicensePlanId
  status: HostedLicenseTokenPayload["status"]
  instanceId: string
  serverLimit: number
  keyPrefix: string
  expiresAt: Date | string | null
  graceUntil: Date | string | null
  activationId?: string
  issuedAt?: Date
}): HostedLicenseTokenPayload {
  const expiresAt =
    input.expiresAt instanceof Date
      ? input.expiresAt.toISOString()
      : input.expiresAt
  const graceUntil =
    input.graceUntil instanceof Date
      ? input.graceUntil.toISOString()
      : input.graceUntil

  return {
    v: 2,
    licenseId: input.licenseId,
    plan: input.plan,
    status: input.status,
    instanceId: input.instanceId,
    features: [...featuresForPlan(input.plan)] as LicenseFeatureId[],
    serverLimit: input.serverLimit,
    keyPrefix: input.keyPrefix || keyDisplayPrefix(input.licenseId),
    issuedAt: (input.issuedAt ?? new Date()).toISOString(),
    expiresAt,
    graceUntil,
    activationId: input.activationId,
  }
}

export type LicenseServerActivateResponse = {
  token: string
  payload: HostedLicenseTokenPayload
  license: {
    id: string
    plan: LicensePlanId
    status: string
    serverLimit: number
    expiresAt: string | null
    graceDays: number
    keyPrefix: string
  }
  activation: {
    id: string
    instanceId: string
    instanceName: string | null
    lastCheckInAt: string | null
    activatedAt: string
  }
  servers: {
    activated: number
    limit: number
  }
}

export type LicenseServerDemoResponse = {
  licenseKey: string
  license: {
    id: string
    plan: LicensePlanId
    status: string
    serverLimit: number
    expiresAt: string | null
    graceDays: number
    keyPrefix: string
    createdAt: string
  }
  customer: {
    id: string
    name: string
    email: string
  }
}

export type LicenseServerStatusResponse = {
  license: {
    id: string
    plan: LicensePlanId
    status: string
    serverLimit: number
    expiresAt: string | null
    graceDays: number
    keyPrefix: string
    createdAt: string
  }
  customer: {
    id: string
    name: string
    email: string
  } | null
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
  servers: {
    activated: number
    limit: number
  }
}
