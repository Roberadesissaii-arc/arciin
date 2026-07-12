import { createHmac, timingSafeEqual } from "node:crypto"

import {
  LICENSE_GRACE_MS,
  defaultLicenseSnapshot,
  evaluateLicenseState,
  keyDisplayPrefix,
  normalizeLicenseKey,
  resolveMockPlanFromKey,
  verifyHostedLicenseToken,
  type LicensePlanId,
  type LicenseStateSnapshot,
} from "@arciin/shared"
import type { PrismaClient } from "@prisma/client"

import { apiConfig } from "@/config"
import {
  hostedActivate,
  hostedDeactivate,
  hostedRefresh,
  licenseDevFallbackEnabled,
  licenseServerBaseUrl,
  licenseVerifySecret,
} from "@/services/license/hosted-client"

type InstanceLicenseRow = {
  id: string
  instanceName: string
  licensePlan: string
  licenseStatus: string
  licenseKeyPrefix: string | null
  licenseActivatedAt: Date | null
  licenseExpiresAt: Date | null
  licenseGraceUntil: Date | null
  licenseSignedToken: string | null
  licenseSource: string | null
}

function mockSigningSecret() {
  return apiConfig.SESSION_SECRET || "arciin-dev-license-secret"
}

/** Legacy v1 local mock tokens (pre-hosted). */
type MockTokenPayload = {
  v: 1
  instanceId: string
  plan: LicensePlanId
  activatedAt: string
  expiresAt: string | null
  graceUntil: string | null
  keyPrefix: string
  source: "mock_dev"
}

function signMockPayload(payload: MockTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const sig = createHmac("sha256", mockSigningSecret()).update(body).digest("base64url")
  return `arclic.v1.${body}.${sig}`
}

export function verifyMockLicenseToken(
  token: string,
  expectedInstanceId: string,
): MockTokenPayload | null {
  const parts = token.split(".")
  if (parts.length !== 4 || parts[0] !== "arclic" || parts[1] !== "v1") return null
  const body = parts[2]!
  const sig = parts[3]!
  const expected = createHmac("sha256", mockSigningSecret()).update(body).digest("base64url")
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as MockTokenPayload
    if (payload.v !== 1 || payload.instanceId !== expectedInstanceId) return null
    return payload
  } catch {
    return null
  }
}

/** @deprecated use verifyMockLicenseToken or verifyHostedLicenseToken */
export function verifySignedLicenseToken(token: string, expectedInstanceId: string) {
  return verifyMockLicenseToken(token, expectedInstanceId)
}

function rowToSnapshot(row: InstanceLicenseRow | null): LicenseStateSnapshot {
  if (!row) return defaultLicenseSnapshot(null)
  return evaluateLicenseState({
    plan: row.licensePlan,
    status: row.licenseStatus,
    instanceId: row.id,
    keyPrefix: row.licenseKeyPrefix,
    activatedAt: row.licenseActivatedAt,
    expiresAt: row.licenseExpiresAt,
    graceUntil: row.licenseGraceUntil,
    signedToken: row.licenseSignedToken,
    source: row.licenseSource,
  })
}

const licenseSelect = {
  id: true,
  instanceName: true,
  licensePlan: true,
  licenseStatus: true,
  licenseKeyPrefix: true,
  licenseActivatedAt: true,
  licenseExpiresAt: true,
  licenseGraceUntil: true,
  licenseSignedToken: true,
  licenseSource: true,
} as const

export async function loadLicenseSnapshot(
  prisma: PrismaClient,
): Promise<LicenseStateSnapshot> {
  const row = await prisma.instanceConfig.findFirst({ select: licenseSelect })
  return rowToSnapshot(row)
}

/**
 * Persist evaluated status if grace/expiry flipped (so DB stays informative).
 */
export async function syncLicenseStatusIfNeeded(
  prisma: PrismaClient,
  snapshot: LicenseStateSnapshot,
): Promise<LicenseStateSnapshot> {
  if (!snapshot.instanceId) return snapshot
  const row = await prisma.instanceConfig.findFirst({
    where: { id: snapshot.instanceId },
    select: { licenseStatus: true, licensePlan: true },
  })
  if (!row) return snapshot
  if (row.licenseStatus === snapshot.status && row.licensePlan === snapshot.plan) {
    return snapshot
  }
  await prisma.instanceConfig.update({
    where: { id: snapshot.instanceId },
    data: {
      licenseStatus: snapshot.status,
      licensePlan: snapshot.plan,
    },
  })
  return snapshot
}

export type ActivateLicenseResult =
  | { ok: true; snapshot: LicenseStateSnapshot }
  | { ok: false; code: string; message: string }

async function persistHostedActivation(
  prisma: PrismaClient,
  instanceId: string,
  data: {
    plan: LicensePlanId
    status: string
    keyPrefix: string
    activatedAt: Date
    expiresAt: Date | null
    graceUntil: Date | null
    signedToken: string
  },
): Promise<LicenseStateSnapshot> {
  // Revoked / expired on server → free core immediately (files still free via free features)
  const revokedOrExpired = data.status === "revoked" || data.status === "expired"
  const plan = revokedOrExpired ? "free" : data.plan
  const status =
    data.status === "grace"
      ? "grace"
      : revokedOrExpired
        ? data.status === "revoked"
          ? "expired"
          : "expired"
        : "active"

  await prisma.instanceConfig.update({
    where: { id: instanceId },
    data: {
      licensePlan: plan,
      licenseStatus: status,
      licenseKeyPrefix: data.keyPrefix,
      licenseActivatedAt: data.activatedAt,
      licenseExpiresAt: data.expiresAt,
      licenseGraceUntil: data.graceUntil,
      licenseSignedToken: revokedOrExpired ? null : data.signedToken,
      licenseSource: "hosted",
    },
  })
  return loadLicenseSnapshot(prisma)
}

/**
 * Activate via hosted license server when configured; otherwise local mock keys.
 * Dev fallback: mock keys still work when ARCIIN_LICENSE_DEV_FALLBACK is on.
 */
export async function activateLicense(
  prisma: PrismaClient,
  rawKey: string,
  options?: { durationDays?: number },
): Promise<ActivateLicenseResult> {
  const instance = await prisma.instanceConfig.findFirst({ select: licenseSelect })
  if (!instance) {
    return {
      ok: false,
      code: "INSTANCE_NOT_READY",
      message: "Claim this instance before activating a license.",
    }
  }

  const key = normalizeLicenseKey(rawKey)
  const serverUrl = licenseServerBaseUrl()
  const isMockKey = Boolean(resolveMockPlanFromKey(key) || /^DEV-(FREE|PRO|TEAM|BUSINESS)/i.test(key))

  // Prefer hosted server for non-mock keys, or always when server configured and key looks hosted
  const looksHosted = /^ARC_(LIC|DEMO)_/i.test(key)
  const tryHosted = Boolean(serverUrl) && (looksHosted || !isMockKey || !licenseDevFallbackEnabled())

  if (tryHosted && serverUrl) {
    const remote = await hostedActivate({
      licenseKey: rawKey.trim(),
      instanceId: instance.id,
      instanceName: instance.instanceName,
      version: apiConfig.appVersion,
    })

    if (remote.ok) {
      const p = remote.data.payload
      // Verify token with our verify secret before trusting
      const verified = verifyHostedLicenseToken(remote.data.token, licenseVerifySecret(), {
        expectedInstanceId: instance.id,
      })
      if (!verified) {
        return {
          ok: false,
          code: "TOKEN_VERIFY_FAILED",
          message:
            "License server returned a token that failed local verification. Check ARCIIN_LICENSE_VERIFY_SECRET matches LICENSE_SIGNING_SECRET.",
        }
      }

      if (verified.status === "revoked" || verified.status === "expired") {
        return {
          ok: false,
          code: verified.status === "revoked" ? "LICENSE_REVOKED" : "LICENSE_EXPIRED",
          message:
            verified.status === "revoked"
              ? "This license has been revoked."
              : "This license has expired.",
        }
      }

      const snapshot = await persistHostedActivation(prisma, instance.id, {
        plan: verified.plan,
        status: verified.status,
        keyPrefix: verified.keyPrefix,
        activatedAt: new Date(remote.data.activation.activatedAt),
        expiresAt: verified.expiresAt ? new Date(verified.expiresAt) : null,
        graceUntil: verified.graceUntil ? new Date(verified.graceUntil) : null,
        signedToken: remote.data.token,
      })
      return { ok: true, snapshot }
    }

    // Unreachable + mock fallback
    if (remote.unreachable && licenseDevFallbackEnabled() && isMockKey) {
      return activateMockLicense(prisma, rawKey, options)
    }

    // Unreachable without valid mock → keep existing if any, else fail
    if (remote.unreachable) {
      return {
        ok: false,
        code: remote.code,
        message: `${remote.message} Set ARCIIN_LICENSE_SERVER_URL or use a dev mock key when fallback is enabled.`,
      }
    }

    return { ok: false, code: remote.code, message: remote.message }
  }

  if (licenseDevFallbackEnabled() || !serverUrl) {
    return activateMockLicense(prisma, rawKey, options)
  }

  return {
    ok: false,
    code: "LICENSE_SERVER_REQUIRED",
    message: "Hosted license server is required. Local mock keys are disabled in this environment.",
  }
}

/**
 * Mock/dev activation — local only (ARCIIN-DEV-* / arc_demo_* when fallback allowed).
 */
export async function activateMockLicense(
  prisma: PrismaClient,
  rawKey: string,
  options?: { durationDays?: number },
): Promise<ActivateLicenseResult> {
  const instance = await prisma.instanceConfig.findFirst()
  if (!instance) {
    return {
      ok: false,
      code: "INSTANCE_NOT_READY",
      message: "Claim this instance before activating a license.",
    }
  }

  const key = normalizeLicenseKey(rawKey)
  let plan = resolveMockPlanFromKey(key)
  let durationDays = options?.durationDays ?? 30

  const durationMatch = /^DEV-(FREE|PRO|TEAM|BUSINESS)-(\d+)D$/.exec(key)
  if (durationMatch) {
    plan = durationMatch[1]!.toLowerCase() as LicensePlanId
    durationDays = Math.min(Math.max(Number(durationMatch[2]), 1), 3650)
  }

  if (!plan) {
    return {
      ok: false,
      code: "INVALID_LICENSE_KEY",
      message: licenseServerBaseUrl()
        ? "Unrecognized key. Generate a key from the demo portal (hosted) or use ARCIIN-DEV-PRO when dev fallback is on."
        : "Unrecognized key. Use a demo portal key (arc_demo_pro_…) or ARCIIN-DEV-PRO / TEAM / BUSINESS / FREE.",
    }
  }

  const now = new Date()
  const activatedAt = now
  const expiresAt =
    plan === "free" ? null : new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000)
  const graceUntil = expiresAt ? new Date(expiresAt.getTime() + LICENSE_GRACE_MS) : null
  const keyPrefix = keyDisplayPrefix(rawKey)

  const tokenPayload: MockTokenPayload = {
    v: 1,
    instanceId: instance.id,
    plan,
    activatedAt: activatedAt.toISOString(),
    expiresAt: expiresAt?.toISOString() ?? null,
    graceUntil: graceUntil?.toISOString() ?? null,
    keyPrefix,
    source: "mock_dev",
  }
  const signedToken = signMockPayload(tokenPayload)

  await prisma.instanceConfig.update({
    where: { id: instance.id },
    data: {
      licensePlan: plan,
      licenseStatus: "active",
      licenseKeyPrefix: keyPrefix,
      licenseActivatedAt: activatedAt,
      licenseExpiresAt: expiresAt,
      licenseGraceUntil: graceUntil,
      licenseSignedToken: signedToken,
      licenseSource: "mock_dev",
    },
  })

  const snapshot = await loadLicenseSnapshot(prisma)
  return { ok: true, snapshot }
}

export async function deactivateLicense(prisma: PrismaClient): Promise<LicenseStateSnapshot> {
  const instance = await prisma.instanceConfig.findFirst({ select: licenseSelect })
  if (!instance) return defaultLicenseSnapshot(null)

  // Notify hosted server when we have a hosted token
  if (
    instance.licenseSource === "hosted" &&
    instance.licenseSignedToken &&
    licenseServerBaseUrl()
  ) {
    await hostedDeactivate({
      token: instance.licenseSignedToken,
      instanceId: instance.id,
    })
    // Ignore unreachable — still clear local license
  }

  await prisma.instanceConfig.update({
    where: { id: instance.id },
    data: {
      licensePlan: "free",
      licenseStatus: "none",
      licenseKeyPrefix: null,
      licenseActivatedAt: null,
      licenseExpiresAt: null,
      licenseGraceUntil: null,
      licenseSignedToken: null,
      licenseSource: "default",
    },
  })

  return loadLicenseSnapshot(prisma)
}

/**
 * Refresh from hosted server when possible; offline keeps stored token until grace ends.
 */
export async function refreshLicense(prisma: PrismaClient): Promise<LicenseStateSnapshot> {
  const instance = await prisma.instanceConfig.findFirst({ select: licenseSelect })
  if (!instance) return defaultLicenseSnapshot(null)

  if (instance.licenseSource === "hosted" && instance.licenseSignedToken && licenseServerBaseUrl()) {
    const remote = await hostedRefresh({
      token: instance.licenseSignedToken,
      instanceId: instance.id,
    })

    if (remote.ok) {
      const verified = verifyHostedLicenseToken(remote.data.token, licenseVerifySecret(), {
        expectedInstanceId: instance.id,
      })
      if (!verified) {
        // Tampered response — keep offline token evaluation
        return evaluateLocalToken(prisma, instance)
      }

      if (verified.status === "revoked" || verified.status === "expired") {
        await prisma.instanceConfig.update({
          where: { id: instance.id },
          data: {
            licensePlan: "free",
            licenseStatus: "expired",
            licenseSignedToken: null,
            licenseSource: "hosted",
            licenseExpiresAt: verified.expiresAt ? new Date(verified.expiresAt) : instance.licenseExpiresAt,
            licenseGraceUntil: verified.graceUntil
              ? new Date(verified.graceUntil)
              : instance.licenseGraceUntil,
          },
        })
        return loadLicenseSnapshot(prisma)
      }

      return persistHostedActivation(prisma, instance.id, {
        plan: verified.plan,
        status: verified.status,
        keyPrefix: verified.keyPrefix,
        activatedAt: instance.licenseActivatedAt ?? new Date(),
        expiresAt: verified.expiresAt ? new Date(verified.expiresAt) : null,
        graceUntil: verified.graceUntil ? new Date(verified.graceUntil) : null,
        signedToken: remote.data.token,
      })
    }

    if (remote.unreachable) {
      // Offline: keep signed token active until local grace ends — never lock files
      return evaluateLocalToken(prisma, instance)
    }

    // Hard error (not activated, etc.) — fall through to local eval
  }

  return evaluateLocalToken(prisma, instance)
}

async function evaluateLocalToken(
  prisma: PrismaClient,
  instance: InstanceLicenseRow,
): Promise<LicenseStateSnapshot> {
  if (instance.licenseSignedToken) {
    if (instance.licenseSource === "hosted" || instance.licenseSignedToken.startsWith("arclic.v2.")) {
      const payload = verifyHostedLicenseToken(instance.licenseSignedToken, licenseVerifySecret(), {
        expectedInstanceId: instance.id,
      })
      if (!payload) {
        await prisma.instanceConfig.update({
          where: { id: instance.id },
          data: {
            licensePlan: "free",
            licenseStatus: "expired",
            licenseSignedToken: null,
            licenseSource: "default",
          },
        })
        return loadLicenseSnapshot(prisma)
      }
      // Trust local timestamps from stored row + token status for revoked
      if (payload.status === "revoked") {
        await prisma.instanceConfig.update({
          where: { id: instance.id },
          data: {
            licensePlan: "free",
            licenseStatus: "expired",
            licenseSignedToken: null,
          },
        })
        return loadLicenseSnapshot(prisma)
      }
    } else {
      const payload = verifyMockLicenseToken(instance.licenseSignedToken, instance.id)
      if (!payload) {
        await prisma.instanceConfig.update({
          where: { id: instance.id },
          data: {
            licensePlan: "free",
            licenseStatus: "expired",
            licenseSignedToken: null,
            licenseSource: "default",
          },
        })
        return loadLicenseSnapshot(prisma)
      }
    }
  }

  const snapshot = rowToSnapshot(instance)
  return syncLicenseStatusIfNeeded(prisma, snapshot)
}
