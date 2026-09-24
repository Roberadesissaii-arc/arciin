import { createHmac } from "node:crypto"

import {
  LICENSE_GRACE_MS,
  defaultLicenseSnapshot,
  keyDisplayPrefix,
  looksLikeHostedLicenseKey,
  describeNonKeyInput,
  normalizeLicenseKey,
  resolveMockPlanFromKey,
  trustedLicenseSnapshotFromRow,
  verifyHostedLicenseToken,
  verifyMockLicenseToken as verifyMockLicenseTokenWithSecret,
  verifyStoredEntitlement,
  type LicensePlanId,
  type LicenseStateSnapshot,
  type MockLicenseTokenPayload,
} from "@arciin/config"
import type { PrismaClient } from "@prisma/client"

import { apiConfig } from "@/config"
import {
  hostedActivate,
  hostedDeactivate,
  hostedRefresh,
  licenseDevFallbackEnabled,
  licenseServerBaseUrl,
  licenseVerifyOptions,
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

function trustedEntitlementContext() {
  return {
    mockHmacSecret: mockSigningSecret(),
    publicKeys: apiConfig.licensePublicKeyRegistry,
    legacyHmacSecret: apiConfig.legacyLicenseSecret,
  }
}

/** Legacy v1 local mock tokens (pre-hosted). */
type MockTokenPayload = MockLicenseTokenPayload

function signMockPayload(payload: MockTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
  const sig = createHmac("sha256", mockSigningSecret()).update(body).digest("base64url")
  return `arclic.v1.${body}.${sig}`
}

export function verifyMockLicenseToken(
  token: string,
  expectedInstanceId: string,
): MockTokenPayload | null {
  return verifyMockLicenseTokenWithSecret(token, expectedInstanceId, mockSigningSecret())
}

/** @deprecated use verifyMockLicenseToken or verifyHostedLicenseToken */
export function verifySignedLicenseToken(token: string, expectedInstanceId: string) {
  return verifyMockLicenseToken(token, expectedInstanceId)
}

function rowToSnapshot(row: InstanceLicenseRow | null): LicenseStateSnapshot {
  return trustedLicenseSnapshotFromRow(row, trustedEntitlementContext())
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

  // Answer the two common paste mistakes precisely, before spending a round
  // trip to the authority to be told "unrecognized" — which is true but sends
  // people looking in the wrong place.
  const shapeProblem = describeNonKeyInput(rawKey)
  if (shapeProblem) {
    return { ok: false, code: "INVALID_LICENSE_KEY", message: shapeProblem }
  }

  const key = normalizeLicenseKey(rawKey)
  const serverUrl = licenseServerBaseUrl()
  const isMockKey = Boolean(resolveMockPlanFromKey(key) || /^DEV-(FREE|PRO|TEAM|BUSINESS)/i.test(key))

  // Prefer hosted server for non-mock keys, or always when server configured and key looks hosted
  const looksHosted = looksLikeHostedLicenseKey(key)
  const tryHosted = Boolean(serverUrl) && (looksHosted || !isMockKey || !licenseDevFallbackEnabled())

  if (tryHosted && serverUrl) {
    const remote = await hostedActivate({
      licenseKey: rawKey.trim(),
      instanceId: instance.id,
      instanceName: instance.instanceName,
      version: apiConfig.appVersion,
    })

    if (remote.ok) {
      // Never trust the response body — only what the signature covers.
      const verified = verifyHostedLicenseToken(
        remote.data.token,
        licenseVerifyOptions(instance.id),
      )
      if (!verified) {
        return {
          ok: false,
          code: "TOKEN_VERIFY_FAILED",
          message:
            "The license server returned a token this build cannot verify. Its signing key may be newer than this Arciin version — update Arciin and try again.",
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
        ? "Unrecognized license key. Get a key from arciin.com after checkout, then paste it here."
        : "Unrecognized license key. Check the key and try again, or open arciin.com/pricing to get a license.",
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
      const verified = verifyHostedLicenseToken(
        remote.data.token,
        licenseVerifyOptions(instance.id),
      )
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

    // Hard authority answers (revoked / not activated / unknown license) must
    // clear local premium state. Falling through to the stored token here was
    // keeping Pro open after deactivate/revoke until the JWT happened to say so.
    const hardClear = new Set([
      "NOT_ACTIVATED",
      "LICENSE_REVOKED",
      "LICENSE_NOT_FOUND",
      "LICENSE_INACTIVE",
      "UNAUTHORIZED_INSTANCE",
    ])
    if (remote.code && hardClear.has(remote.code)) {
      await prisma.instanceConfig.update({
        where: { id: instance.id },
        data: {
          licensePlan: "free",
          licenseStatus: remote.code === "LICENSE_REVOKED" ? "expired" : "none",
          licenseSignedToken: null,
          licenseSource: "hosted",
          licenseKeyPrefix: instance.licenseKeyPrefix,
        },
      })
      return loadLicenseSnapshot(prisma)
    }
  }

  return evaluateLocalToken(prisma, instance)
}

async function evaluateLocalToken(
  prisma: PrismaClient,
  instance: InstanceLicenseRow,
): Promise<LicenseStateSnapshot> {
  // `rowToSnapshot` already refuses to honour a token that does not verify, so
  // the entitlement is safe either way. Clearing the dead token here is the
  // housekeeping half: it stops the licence screen advertising a key that can
  // never be honoured, and it is a write, so it belongs on the refresh path
  // rather than on every read.
  if (instance.licenseSignedToken && !verifyStoredEntitlement(instance, trustedEntitlementContext())) {
    await prisma.instanceConfig.update({
      where: { id: instance.id },
      data: {
        licensePlan: "free",
        licenseStatus: "expired",
        licenseSignedToken: null,
        licenseSource: instance.licenseSource === "hosted" ? "hosted" : "default",
      },
    })
    return loadLicenseSnapshot(prisma)
  }

  const snapshot = rowToSnapshot(instance)
  return syncLicenseStatusIfNeeded(prisma, snapshot)
}
