/**
 * Trusted entitlement snapshot from a stored instance row.
 *
 * Wave 1 (ARC-001): paid plans come from a verified token, never from the
 * `licensePlan` / `licenseStatus` columns. The API and the worker must share
 * this function so a queued job cannot execute paid work against a forged row.
 */

import { createHmac, timingSafeEqual } from "node:crypto"

import { defaultLicenseSnapshot, evaluateLicenseState, type LicenseStateSnapshot } from "./license"
import { licenseTokenVersion, verifyHostedLicenseToken, type VerifyLicenseTokenOptions } from "./license-token"
import type { LicensePlanId } from "./entitlements"
import type { LicensePublicKeyRegistry } from "./license-signing"

export type InstanceLicenseRow = {
  id: string
  licensePlan: string
  licenseStatus: string
  licenseKeyPrefix: string | null
  licenseActivatedAt: Date | null
  licenseExpiresAt: Date | null
  licenseGraceUntil: Date | null
  licenseSignedToken: string | null
  licenseSource: string | null
}

export type TrustedEntitlementContext = {
  /** HMAC secret for local v1 mock tokens (SESSION_SECRET). */
  mockHmacSecret: string
  publicKeys: LicensePublicKeyRegistry
  legacyHmacSecret?: string | null
}

export type MockLicenseTokenPayload = {
  v: 1
  instanceId: string
  plan: LicensePlanId
  activatedAt: string
  expiresAt: string | null
  graceUntil: string | null
  keyPrefix: string
  source: "mock_dev"
}

export function verifyMockLicenseToken(
  token: string,
  expectedInstanceId: string,
  mockHmacSecret: string,
): MockLicenseTokenPayload | null {
  const parts = token.split(".")
  if (parts.length !== 4 || parts[0] !== "arclic" || parts[1] !== "v1") return null
  const body = parts[2]!
  const sig = parts[3]!
  const expected = createHmac("sha256", mockHmacSecret).update(body).digest("base64url")
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MockLicenseTokenPayload
    if (payload.v !== 1 || payload.instanceId !== expectedInstanceId) return null
    return payload
  } catch {
    return null
  }
}

export type VerifiedEntitlement = {
  plan: LicensePlanId
  expiresAt: Date | null
  graceUntil: Date | null
  keyPrefix: string | null
}

/**
 * What this instance can prove it holds. `null` is free core.
 *
 * Column values are display cache. A forged `licensePlan = business` with any
 * non-empty token string must land here as null.
 */
export function verifyStoredEntitlement(
  row: InstanceLicenseRow,
  ctx: TrustedEntitlementContext,
): VerifiedEntitlement | null {
  const token = row.licenseSignedToken
  if (!token) return null

  if (row.licenseSource !== "hosted" && licenseTokenVersion(token) === null) {
    const mock = verifyMockLicenseToken(token, row.id, ctx.mockHmacSecret)
    if (!mock) return null
    return {
      plan: mock.plan,
      expiresAt: mock.expiresAt ? new Date(mock.expiresAt) : null,
      graceUntil: mock.graceUntil ? new Date(mock.graceUntil) : null,
      keyPrefix: mock.keyPrefix,
    }
  }

  const options: VerifyLicenseTokenOptions = {
    publicKeys: ctx.publicKeys,
    legacyHmacSecret: ctx.legacyHmacSecret,
    expectedInstanceId: row.id,
  }
  const payload = verifyHostedLicenseToken(token, options)
  if (!payload) return null
  if (payload.status === "revoked" || payload.status === "expired" || payload.status === "inactive") {
    return null
  }

  return {
    plan: payload.plan,
    expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
    graceUntil: payload.graceUntil ? new Date(payload.graceUntil) : null,
    keyPrefix: payload.keyPrefix || row.licenseKeyPrefix,
  }
}

export function trustedLicenseSnapshotFromRow(
  row: InstanceLicenseRow | null,
  ctx: TrustedEntitlementContext,
): LicenseStateSnapshot {
  if (!row) return defaultLicenseSnapshot(null)

  const verified = verifyStoredEntitlement(row, ctx)
  if (!verified) {
    return {
      ...defaultLicenseSnapshot(row.id),
      keyPrefix: row.licenseKeyPrefix,
      activatedAt: row.licenseActivatedAt?.toISOString() ?? null,
    }
  }

  return evaluateLicenseState({
    plan: verified.plan,
    status: row.licenseStatus,
    instanceId: row.id,
    keyPrefix: verified.keyPrefix,
    activatedAt: row.licenseActivatedAt,
    expiresAt: verified.expiresAt,
    graceUntil: verified.graceUntil,
    signedToken: row.licenseSignedToken,
    source: row.licenseSource,
  })
}
