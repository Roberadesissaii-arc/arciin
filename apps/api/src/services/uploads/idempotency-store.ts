/**
 * Persistence for Idempotency-Key handling.
 *
 * The decision logic lives in `@arciin/shared` (pure, unit-tested); this file
 * is only the database half. The one subtle part is `beginIdempotentRequest`:
 * two concurrent requests with the same key must not both proceed, and the way
 * to guarantee that is the unique index on (scope, key) — not a read-then-write,
 * which has a window between the read and the write wide enough to drive two
 * uploads through.
 */

import { createHash } from "node:crypto"

import type { PrismaClient } from "@prisma/client"

import {
  decideIdempotency,
  idempotencyExpiry,
  type IdempotencyDecision,
} from "@arciin/shared"

export function hashRequestFingerprint(canonical: string): string {
  return createHash("sha256").update(canonical).digest("hex")
}

/**
 * Claim a key, or report what the existing claim means.
 *
 * `proceed` is returned only to the caller that actually created the row (or
 * revived an expired/failed one), so exactly one concurrent request runs.
 */
export async function beginIdempotentRequest(
  prisma: PrismaClient,
  input: { scope: string; key: string; requestHash: string; now?: Date },
): Promise<IdempotencyDecision> {
  const now = input.now ?? new Date()

  const existing = await prisma.idempotencyRecord.findUnique({
    where: { scope_key: { scope: input.scope, key: input.key } },
  })

  const decision = decideIdempotency({
    existing: existing
      ? {
          key: existing.key,
          requestHash: existing.requestHash,
          status: existing.status,
          responseCode: existing.responseCode,
          responseBody: existing.responseBody,
          expiresAt: existing.expiresAt,
        }
      : null,
    requestHash: input.requestHash,
    now: now.getTime(),
  })

  if (decision.action !== "proceed") return decision

  try {
    if (existing) {
      // Revive only from a state the decision function already blessed, and
      // only if nobody else revived it first — hence the status guard.
      const revived = await prisma.idempotencyRecord.updateMany({
        where: {
          scope: input.scope,
          key: input.key,
          status: existing.status,
          updatedAt: existing.updatedAt,
        },
        data: {
          requestHash: input.requestHash,
          status: "IN_FLIGHT",
          responseCode: null,
          responseBody: undefined,
          expiresAt: idempotencyExpiry(now),
        },
      })
      if (revived.count === 0) {
        return {
          action: "in_flight",
          code: "IDEMPOTENCY_IN_FLIGHT",
          message: "An identical request is already being processed. Retry shortly.",
        }
      }
      return { action: "proceed" }
    }

    await prisma.idempotencyRecord.create({
      data: {
        scope: input.scope,
        key: input.key,
        requestHash: input.requestHash,
        status: "IN_FLIGHT",
        expiresAt: idempotencyExpiry(now),
      },
    })
    return { action: "proceed" }
  } catch {
    // Unique-constraint violation: another request claimed the key between our
    // read and our write. That request is the one that proceeds.
    return {
      action: "in_flight",
      code: "IDEMPOTENCY_IN_FLIGHT",
      message: "An identical request is already being processed. Retry shortly.",
    }
  }
}

export async function completeIdempotentRequest(
  prisma: PrismaClient,
  input: { scope: string; key: string; responseCode: number; responseBody: unknown },
): Promise<void> {
  await prisma.idempotencyRecord.updateMany({
    where: { scope: input.scope, key: input.key },
    data: {
      status: "COMPLETED",
      responseCode: input.responseCode,
      responseBody: input.responseBody as never,
    },
  })
}

/**
 * Mark a claim as failed so the caller's retry is allowed through.
 *
 * Deleting the row instead would also work, but leaving a FAILED record keeps
 * the failure visible when someone asks why a key behaved oddly.
 */
export async function failIdempotentRequest(
  prisma: PrismaClient,
  input: { scope: string; key: string },
): Promise<void> {
  await prisma.idempotencyRecord
    .updateMany({
      where: { scope: input.scope, key: input.key, status: "IN_FLIGHT" },
      data: { status: "FAILED" },
    })
    .catch(() => {})
}

export async function pruneExpiredIdempotencyRecords(prisma: PrismaClient): Promise<number> {
  const result = await prisma.idempotencyRecord.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })
  return result.count
}
