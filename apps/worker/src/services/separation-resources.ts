import { freemem } from "node:os"

import type Redis from "ioredis"

/**
 * Making sure two separations never run at once on this machine.
 *
 * Measured here: `audio-separator` reaches 2.28 GB resident on a twelve-minute
 * file, on a box with 7.1 GB total and swap largely consumed. One is fine. Two
 * is not, and the failure mode is not a slow job — it is the kernel killing one
 * of them part-way, which is exactly what happened while the browser suite was
 * running alongside it.
 *
 * The lock lives in Redis rather than in the worker process for two reasons.
 * The queue may eventually run more than one worker, and a module-level boolean
 * would be per-process — which is the same bug with a longer fuse. And a worker
 * that is restarted mid-job must not leave the machine permanently "busy", so
 * the lock expires on its own and is renewed while the work continues.
 */

/** One separation. Not a tunable: it is a property of this hardware. */
const LOCK_KEY = "arciin:separation:local"

/**
 * Long enough to survive a slow chunk, short enough that a crashed worker frees
 * the machine within a few minutes rather than until someone notices.
 */
const LOCK_TTL_SECONDS = 300

/** Renewed well inside the TTL, so one missed tick is not fatal. */
const RENEW_INTERVAL_MS = 60_000

/**
 * What a separation needs to have a chance.
 *
 * Below the observed peak plus headroom for the rest of the instance. Waiting
 * is better than starting: a job that begins with 1 GB free will be killed
 * after twenty minutes of work, and a job that waits five minutes for the
 * browser suite to finish will simply run.
 */
export const MIN_FREE_MEMORY_BYTES = 2.6 * 1024 * 1024 * 1024

export type SeparationSlot = {
  release: () => Promise<void>
}

export class SeparationBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SeparationBusyError"
  }
}

/** Free memory including what the kernel can reclaim from cache. */
export function availableMemoryBytes(): number {
  return freemem()
}

export function hasMemoryForSeparation(
  available = availableMemoryBytes(),
  required = MIN_FREE_MEMORY_BYTES,
): boolean {
  return available >= required
}

/**
 * Take the machine's separation slot, waiting rather than failing.
 *
 * Returns null if the wait runs out — the caller reports that as a stage the
 * reader can understand ("waiting for local processing resources"), not as an
 * error. Manufacturing a failure when the honest answer is "something else is
 * using this server" would be both wrong and unhelpful.
 */
export async function acquireSeparationSlot(
  redis: Redis,
  options: {
    /** How long to wait for the slot before giving up. */
    waitMs?: number
    /** Called each time the wait continues, so the UI can say why. */
    onWaiting?: (reason: "busy" | "memory") => void | Promise<void>
    pollMs?: number
    now?: () => number
  } = {},
): Promise<SeparationSlot | null> {
  const waitMs = options.waitMs ?? 30 * 60 * 1000
  const pollMs = options.pollMs ?? 15_000
  const now = options.now ?? (() => Date.now())
  const deadline = now() + waitMs

  const token = `${process.pid}-${Math.random().toString(36).slice(2)}`

  while (now() <= deadline) {
    // Memory first: holding the lock while too low to use it would block a
    // machine that is about to become able to run the job.
    if (!hasMemoryForSeparation()) {
      await options.onWaiting?.("memory")
      await sleep(pollMs)
      continue
    }

    const taken = await redis.set(LOCK_KEY, token, "EX", LOCK_TTL_SECONDS, "NX")
    if (taken === "OK") {
      const renew = setInterval(() => {
        // Only if still ours: a lock that expired and was taken by another job
        // must not be silently reclaimed.
        void redis
          .eval(
            `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end`,
            1,
            LOCK_KEY,
            token,
            String(LOCK_TTL_SECONDS),
          )
          .catch(() => {})
      }, RENEW_INTERVAL_MS)
      renew.unref?.()

      return {
        release: async () => {
          clearInterval(renew)
          await redis
            .eval(
              `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
              1,
              LOCK_KEY,
              token,
            )
            .catch(() => {})
        },
      }
    }

    await options.onWaiting?.("busy")
    await sleep(pollMs)
  }

  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}
