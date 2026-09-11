import type { Queue } from "bullmq"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  dispatchPendingForUpload,
  reconcileOutbox,
} from "../../apps/api/src/services/uploads/outbox-dispatch"

import { prisma } from "./setup"

/**
 * The outbox has to keep its guarantee now that enqueueing can fail.
 *
 * Bounding the BullMQ producer (ARC-002) changed `queue.add()` from "waits
 * forever while Redis is down" to "rejects in a few seconds". The outbox was
 * always written to cope with a failed dispatch — but it never actually saw
 * one, because the call never returned to fail. These tests drive that path
 * deliberately: a rejected enqueue must leave the work owed, and the
 * reconciler must still pay it once Redis is back.
 *
 * If this ever regresses into "dispatch failed, so drop the row", uploads go
 * back to sitting on "Processing" forever after any Redis blip.
 */

/** A queue whose enqueue fails the way a bounded client fails. */
function unreachableQueue(): Record<string, Queue> {
  const add = async () => {
    throw new Error("Command timed out")
  }
  return { media: { add } as unknown as Queue }
}

function workingQueue(accepted: string[]): Record<string, Queue> {
  const add = async (_name: string, _payload: unknown, opts: { jobId: string }) => {
    accepted.push(opts.jobId)
    return { id: opts.jobId }
  }
  return { media: { add } as unknown as Queue }
}

const ENTRY = {
  outboxId: "",
  jobId: "wave1-job-1",
  queue: "media",
  jobName: "analyze_file",
  payload: { jobRecordId: "job-record-1" },
}

beforeEach(async () => {
  await prisma.uploadOutbox.deleteMany()
  const row = await prisma.uploadOutbox.create({
    data: {
      jobId: ENTRY.jobId,
      queue: ENTRY.queue,
      jobName: ENTRY.jobName,
      payload: ENTRY.payload as never,
    },
  })
  ENTRY.outboxId = row.id
})

afterEach(async () => {
  await prisma.uploadOutbox.deleteMany()
})

describe("dispatching while Redis is unreachable", () => {
  it("does not throw into the request", async () => {
    const result = await dispatchPendingForUpload(prisma, unreachableQueue(), [ENTRY])
    expect(result).toMatchObject({ dispatched: 0, deferred: 1 })
  })

  it("leaves the job owed rather than dropping it", async () => {
    await dispatchPendingForUpload(prisma, unreachableQueue(), [ENTRY])

    const row = await prisma.uploadOutbox.findUniqueOrThrow({ where: { id: ENTRY.outboxId } })
    expect(row.status).toBe("PENDING")
    expect(row.attempts).toBe(1)
    expect(row.lastError).toBeTruthy()
  })

  it("backs off before the next attempt instead of spinning", async () => {
    const before = Date.now()
    await dispatchPendingForUpload(prisma, unreachableQueue(), [ENTRY])

    const row = await prisma.uploadOutbox.findUniqueOrThrow({ where: { id: ENTRY.outboxId } })
    expect(row.availableAt.getTime()).toBeGreaterThan(before)
  })
})

describe("once Redis comes back", () => {
  it("the reconciler dispatches the work that was deferred", async () => {
    await dispatchPendingForUpload(prisma, unreachableQueue(), [ENTRY])

    // The reconciler only picks up rows that are due; the backoff above pushed
    // this one into the future, which is the behaviour under test elsewhere.
    await prisma.uploadOutbox.update({
      where: { id: ENTRY.outboxId },
      data: { availableAt: new Date(Date.now() - 1_000) },
    })

    const accepted: string[] = []
    const result = await reconcileOutbox(prisma, workingQueue(accepted))

    expect(result).toMatchObject({ scanned: 1, dispatched: 1, deferred: 0 })
    expect(accepted).toEqual([ENTRY.jobId])

    const row = await prisma.uploadOutbox.findUniqueOrThrow({ where: { id: ENTRY.outboxId } })
    expect(row.status).toBe("DISPATCHED")
    expect(row.dispatchedAt).not.toBeNull()
  })

  it("does not re-dispatch work that already went out", async () => {
    const accepted: string[] = []
    await reconcileOutbox(prisma, workingQueue(accepted))
    await reconcileOutbox(prisma, workingQueue(accepted))

    expect(accepted).toEqual([ENTRY.jobId])
  })
})
