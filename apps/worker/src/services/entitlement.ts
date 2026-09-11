/**
 * Trusted entitlement checks for paid worker jobs.
 *
 * The API already refuses to enqueue paid work on a Free instance. A job that
 * is inserted directly, or that sits in the queue across a revoke, must still
 * be refused here. The columns on InstanceConfig are not authority — Wave 1
 * signature verification is.
 */

import { UnrecoverableError } from "bullmq"
import type { PrismaClient } from "@prisma/client"

import {
  defaultPublicKeyRegistry,
  featureForPaidWorkerJob,
  hasFeature,
  trustedLicenseSnapshotFromRow,
  type LicenseFeatureId,
  type LicenseStateSnapshot,
} from "@arciin/shared"

export const LICENSE_REQUIRED_CODE = "LICENSE_REQUIRED"

export class LicenseRequiredError extends UnrecoverableError {
  readonly code = LICENSE_REQUIRED_CODE
  readonly feature: LicenseFeatureId

  constructor(feature: LicenseFeatureId) {
    super(`This feature requires a higher Arciin plan (${feature}).`)
    this.name = "LicenseRequiredError"
    this.feature = feature
  }
}

function mockSigningSecret() {
  return process.env.SESSION_SECRET || "arciin-dev-license-secret"
}

function workerEntitlementContext() {
  return {
    mockHmacSecret: mockSigningSecret(),
    publicKeys: defaultPublicKeyRegistry(process.env.ARCIIN_LICENSE_PUBLIC_KEYS),
    legacyHmacSecret: process.env.ARCIIN_LICENSE_VERIFY_SECRET ?? null,
  }
}

export async function loadWorkerLicenseSnapshot(
  prisma: PrismaClient,
): Promise<LicenseStateSnapshot> {
  const row = await prisma.instanceConfig.findFirst({
    select: {
      id: true,
      licensePlan: true,
      licenseStatus: true,
      licenseKeyPrefix: true,
      licenseActivatedAt: true,
      licenseExpiresAt: true,
      licenseGraceUntil: true,
      licenseSignedToken: true,
      licenseSource: true,
    },
  })
  return trustedLicenseSnapshotFromRow(row, workerEntitlementContext())
}

export async function assertWorkerFeature(
  prisma: PrismaClient,
  feature: LicenseFeatureId,
): Promise<LicenseStateSnapshot> {
  const snapshot = await loadWorkerLicenseSnapshot(prisma)
  if (!hasFeature(snapshot, feature)) {
    throw new LicenseRequiredError(feature)
  }
  return snapshot
}

/**
 * Re-check the current trusted licence before executing a paid job.
 *
 * Returns null for unpaid job types. Throws LicenseRequiredError (unrecoverable)
 * when the instance no longer holds the feature — including forged columns,
 * revoked tokens, and downgrades that happened after enqueue.
 */
export async function assertPaidJobEntitlement(
  prisma: PrismaClient,
  jobName: string,
): Promise<LicenseStateSnapshot | null> {
  const feature = featureForPaidWorkerJob(jobName)
  if (!feature) return null
  return assertWorkerFeature(prisma, feature)
}

export function isLicenseRequiredError(error: unknown): error is LicenseRequiredError {
  return error instanceof LicenseRequiredError
}
