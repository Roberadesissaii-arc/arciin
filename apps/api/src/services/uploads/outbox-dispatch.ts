/**
 * Outbox dispatch and reconciliation.
 *
 * `commitUpload` leaves durable rows saying "these jobs are owed". This module
 * is the only thing that turns them into BullMQ jobs, and it is deliberately
 * safe to call twice, concurrently, from anywhere:
 *
 *   - the job id is derived from the work, so BullMQ collapses duplicates
 *   - the status transition is a conditional UPDATE, so only one caller wins
 *
 * Called immediately after commit for latency, and periodically by the
 * reconciler for correctness. The immediate call is an optimisation; the
 * reconciler is the guarantee.
 */

import type { PrismaClient } from "@prisma/client"
import type { Queue } from "bullmq"

import { outboxRetryDelayMs } from "@arciin/shared"

export type DispatchableOutboxEntry = {
  id: string
  jobId: string
  queue: string
  jobName: string
  payload: unknown
  attempts: number
}

export type OutboxQueues = Record<string, Queue>

/**
 * Dispatch one entry.
 *
 * Marking DISPATCHED *before* the enqueue would lose the job if the enqueue
 * then failed; marking after risks a second dispatch if the process dies in
 * between. The second is the safe failure, because a duplicate dispatch reuses
 * the same deterministic job id and BullMQ discards it.
 */
export async function dispatchOutboxEntry(
  prisma: PrismaClient,
  queues: OutboxQueues,
  entry: DispatchableOutboxEntry,
): Promise<{ dispatched: boolean; error?: string }> {
  const queue = queues[entry.queue]
  if (!queue) {
    await prisma.uploadOutbox.update({
      where: { id: entry.id },
      data: {
        status: "FAILED",
        lastError: `No queue registered under "${entry.queue}".`,
        attempts: { increment: 1 },
      },
    })
    return { dispatched: false, error: "UNKNOWN_QUEUE" }
  }

  // Claim the row first so two reconcilers cannot both spend attempts on it.
  const claimed = await prisma.uploadOutbox.updateMany({
    where: { id: entry.id, status: "PENDING" },
    data: { attempts: { increment: 1 } },
  })
  if (claimed.count === 0) {
    return { dispatched: false, error: "ALREADY_CLAIMED" }
  }

  try {
    await queue.add(entry.jobName, entry.payload, { jobId: entry.jobId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const attempts = entry.attempts + 1
    await prisma.uploadOutbox.update({
      where: { id: entry.id },
      data: {
        // Stays PENDING: Redis being down is temporary, and abandoning the row
        // here is exactly the bug this whole mechanism exists to prevent.
        status: "PENDING",
        lastError: message.slice(0, 500),
        availableAt: new Date(Date.now() + outboxRetryDelayMs(attempts)),
      },
    })
    return { dispatched: false, error: message }
  }

  await prisma.uploadOutbox.update({
    where: { id: entry.id },
    data: { status: "DISPATCHED", dispatchedAt: new Date(), lastError: null },
  })

  return { dispatched: true }
}

/** Best-effort dispatch straight after commit. Never throws into the request. */
export async function dispatchPendingForUpload(
  prisma: PrismaClient,
  queues: OutboxQueues,
  entries: { outboxId: string; jobId: string; queue: string; jobName: string; payload: unknown }[],
  log?: { warn: (obj: unknown, msg: string) => void },
): Promise<{ dispatched: number; deferred: number }> {
  let dispatched = 0
  let deferred = 0

  for (const entry of entries) {
    try {
      const result = await dispatchOutboxEntry(prisma, queues, {
        id: entry.outboxId,
        jobId: entry.jobId,
        queue: entry.queue,
        jobName: entry.jobName,
        payload: entry.payload,
        attempts: 0,
      })
      if (result.dispatched) dispatched += 1
      else deferred += 1
    } catch (error) {
      // A failure to *record* a failure still must not fail the upload; the
      // row stays PENDING and the reconciler picks it up.
      deferred += 1
      log?.warn({ err: error, jobId: entry.jobId }, "outbox dispatch failed; deferred")
    }
  }

  return { dispatched, deferred }
}

/**
 * Drain everything that is due. This is what makes "Redis was down" recoverable
 * rather than permanent.
 */
export async function reconcileOutbox(
  prisma: PrismaClient,
  queues: OutboxQueues,
  options: { batchSize?: number } = {},
): Promise<{ scanned: number; dispatched: number; deferred: number }> {
  const entries = await prisma.uploadOutbox.findMany({
    where: { status: "PENDING", availableAt: { lte: new Date() } },
    orderBy: { availableAt: "asc" },
    take: options.batchSize ?? 100,
    select: {
      id: true,
      jobId: true,
      queue: true,
      jobName: true,
      payload: true,
      attempts: true,
    },
  })

  let dispatched = 0
  let deferred = 0

  for (const entry of entries) {
    const result = await dispatchOutboxEntry(prisma, queues, entry)
    if (result.dispatched) dispatched += 1
    else deferred += 1
  }

  return { scanned: entries.length, dispatched, deferred }
}

/** Dispatched rows are only kept long enough to be useful when debugging. */
export async function pruneDispatchedOutbox(
  prisma: PrismaClient,
  olderThanMs = 7 * 24 * 60 * 60 * 1000,
): Promise<number> {
  const result = await prisma.uploadOutbox.deleteMany({
    where: {
      status: "DISPATCHED",
      dispatchedAt: { lt: new Date(Date.now() - olderThanMs) },
    },
  })
  return result.count
}
