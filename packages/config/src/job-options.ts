/**
 * Default BullMQ job options, shared by every producer so the API and the
 * worker's own enqueues behave identically.
 */

/**
 * Retry transient failures a couple of times.
 *
 * Media work fails for two very different reasons: a transient one (ffmpeg
 * killed under memory pressure, a brief disk stall, Redis blip) which a retry
 * fixes, and a deterministic one (unsupported codec, missing file) which no
 * number of retries will. Producers set the retry budget here; the worker
 * throws `UnrecoverableError` for the deterministic cases so they fail once
 * and stop.
 */
export const MEDIA_JOB_ATTEMPTS = 3

export const DEFAULT_MEDIA_JOB_OPTIONS = {
  attempts: MEDIA_JOB_ATTEMPTS,
  backoff: { type: "exponential" as const, delay: 5_000 },
  /**
   * Bounded retention. Without this, completed job hashes accumulate in Redis
   * forever — this instance had built up ~3,900 of them, which was the bulk of
   * its keyspace. Failures are kept far longer because they are the ones worth
   * reading after the fact.
   */
  removeOnComplete: { count: 500, age: 7 * 24 * 60 * 60 },
  removeOnFail: { count: 1_000, age: 30 * 24 * 60 * 60 },
}

/**
 * Short-window burst guard for the media queue.
 *
 * The previous value was `{ max: concurrency * 2, duration: 60_000 }` — four
 * jobs per *minute* at the default concurrency of 2. Since an image or video
 * upload creates two jobs, that throttled the instance to roughly two uploads
 * a minute and was the main reason bulk uploads appeared to hang.
 *
 * Concurrency is what actually bounds CPU and memory; this only stops a
 * pathological burst from thrashing the queue, so the window is one second.
 */
export function mediaQueueLimiter(concurrency: number) {
  return { max: Math.max(1, concurrency) * 4, duration: 1_000 }
}

/**
 * Repeatable maintenance schedules.
 *
 * Registered by name so BullMQ deduplicates them: restarting the worker, or
 * running more than one worker, cannot install the same schedule twice.
 */
export const MAINTENANCE_SCHEDULES = {
  cleanupTempFiles: {
    /** Hourly is frequent enough for a 24h retention window and cheap to run. */
    name: "arciin:cleanup-temp-files",
    everyMs: 60 * 60 * 1000,
  },
  storageIntegrityScan: {
    /** Report-only; daily is plenty. */
    name: "arciin:storage-integrity-scan",
    everyMs: 24 * 60 * 60 * 1000,
  },
} as const

/** Retention for maintenance jobs — far smaller than the media queue's. */
export const MAINTENANCE_JOB_OPTIONS = {
  removeOnComplete: { count: 50, age: 7 * 24 * 60 * 60 },
  removeOnFail: { count: 100, age: 30 * 24 * 60 * 60 },
  attempts: 1,
}
