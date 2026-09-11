import { setInterval } from "node:timers"

import { Queue, Worker } from "bullmq"
import Redis from "ioredis"

import {
  JOB_QUEUE_NAMES,
  JOB_TYPES,
  MAINTENANCE_JOB_OPTIONS,
  MAINTENANCE_SCHEDULES,
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_CONNECT_TIMEOUT_MS,
  mediaQueueLimiter,
  redisRetryDelayMs,
} from "@arciin/shared"

import { workerConfig } from "@/config"
import {
  failUploadForJob,
  handleIntegrationJob,
  handleMediaJob,
  handleStorageJob,
  markJobFailure,
} from "@/processors/worker-handlers"
import { maybeRunScheduledStage } from "@/services/auto-update"
import { handleImportUrl } from "@/services/url-import"

const redisUrl = new URL(workerConfig.REDIS_URL)

const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: redisUrl.pathname ? Number(redisUrl.pathname.slice(1)) || 0 : 0,
  tls: redisUrl.protocol === "rediss:" ? {} : undefined,
  /**
   * Required by BullMQ: Workers issue long-blocking Redis reads to wait for
   * new jobs. ioredis's default maxRetriesPerRequest (20) eventually throws
   * on those blocking calls during any transient hiccup, which silently
   * kills the job-fetch loop for good — the process stays "online" but never
   * picks up another job until restarted. This is why queued uploads were
   * getting stuck showing "Processing" forever.
   */
  maxRetriesPerRequest: null as null,
}

async function start() {
  /**
   * Heartbeat and realtime publishing only — no blocking reads, so unlike the
   * BullMQ `connection` above this one gets finite deadlines. Without them a
   * Redis outage left every `set` and `publish` pending forever and the log
   * filling with reconnect errors (ARC-002).
   */
  const redis = new Redis(workerConfig.REDIS_URL, {
    connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    retryStrategy: redisRetryDelayMs,
  })

  // One line per state change rather than one per failed reconnect.
  let redisDown = false
  redis.on("error", (error: Error) => {
    if (redisDown) return
    redisDown = true
    console.error("[worker] Redis connection lost:", error.message)
  })
  redis.on("ready", () => {
    if (!redisDown) return
    redisDown = false
    console.log("[worker] Redis connection restored")
  })

  // Commands can now reject, and an unhandled rejection would take the worker
  // down over something as recoverable as a missed heartbeat.
  const writeHeartbeat = () =>
    redis.set(workerConfig.workerHeartbeatKey, String(Date.now())).catch(() => {
      // The API reports the worker offline until the next tick succeeds, which
      // is exactly what an operator should see while Redis is unreachable.
    })

  const heartbeat = setInterval(() => {
    void writeHeartbeat()
  }, 15_000)

  await writeHeartbeat()

  const mediaWorker = new Worker(
    JOB_QUEUE_NAMES.media,
    async (job) => {
      try {
        if (job.name === JOB_TYPES.importUrl) {
          await handleImportUrl(job.data, redis)
        } else {
          await handleMediaJob(job.name, job.data, redis)
        }
      } catch (error) {
        await markJobFailure(job.data.jobRecordId, error)
        // Give the upload a visible failed state instead of leaving the queue
        // item stuck on "Processing" with the error only in the worker log.
        await failUploadForJob(redis, job.data, error).catch((notifyError) => {
          console.error("[worker] could not report upload failure", notifyError)
        })
        throw error
      }
    },
    {
      connection,
      // Concurrency is what bounds CPU/RAM for transcodes and thumbnailing.
      // The limiter is only a burst guard on a one-second window — it used to
      // use a 60s window, which capped the whole instance at ~2 uploads per
      // minute and made bulk uploads look like they had hung.
      concurrency: workerConfig.ARCIIN_WORKER_CONCURRENCY,
      limiter: mediaQueueLimiter(workerConfig.ARCIIN_WORKER_CONCURRENCY),
      // Must match the producer prefix, or this worker sees no jobs at all —
      // and, crucially, a dev worker never sees production jobs.
      prefix: workerConfig.queuePrefix,
    }
  )

  const storageWorker = new Worker(
    JOB_QUEUE_NAMES.storage,
    async (job) => {
      try {
        await handleStorageJob(job.name, job.data, redis)
      } catch (error) {
        await markJobFailure(job.data.jobRecordId, error)
        throw error
      }
    },
    { connection, prefix: workerConfig.queuePrefix }
  )

  // Checks once an hour whether it's the user's configured auto-update
  // window; stages (never applies) at most once per available version.
  const autoUpdateCheck = setInterval(() => {
    void maybeRunScheduledStage(redis).catch((error) => {
      console.error("[auto-update] scheduled stage check failed", error)
    })
  }, 60 * 60_000)

  const integrationsWorker = new Worker(
    JOB_QUEUE_NAMES.integrations,
    async (job) => {
      try {
        await handleIntegrationJob(job.name, job.data, redis)
      } catch (error) {
        await markJobFailure(job.data.jobRecordId, error)
        throw error
      }
    },
    { connection, prefix: workerConfig.queuePrefix }
  )

  // Maintenance schedules. The handlers existed but nothing ever enqueued
  // them, so temp files accumulated indefinitely (~1.5 GB observed).
  // Registering by a fixed `repeat.key` makes this idempotent: restarting the
  // worker, or running several, installs the schedule exactly once.
  const storageQueueForSchedules = new Queue(JOB_QUEUE_NAMES.storage, {
    connection,
    prefix: workerConfig.queuePrefix,
  })

  try {
    await storageQueueForSchedules.add(
      JOB_TYPES.cleanupTempFiles,
      { olderThanHours: workerConfig.ARCIIN_TEMP_MAX_AGE_HOURS },
      {
        ...MAINTENANCE_JOB_OPTIONS,
        repeat: {
          every: MAINTENANCE_SCHEDULES.cleanupTempFiles.everyMs,
          key: MAINTENANCE_SCHEDULES.cleanupTempFiles.name,
        },
      },
    )
    console.log(
      `[worker] maintenance scheduled: temp cleanup every ${
        MAINTENANCE_SCHEDULES.cleanupTempFiles.everyMs / 60_000
      }m (retention ${workerConfig.ARCIIN_TEMP_MAX_AGE_HOURS}h)`,
    )
  } catch (error) {
    // A scheduling failure must not stop the worker from processing uploads.
    console.error("[worker] could not register maintenance schedules", error)
  }

  const shutdown = async () => {
    clearInterval(heartbeat)
    clearInterval(autoUpdateCheck)
    await Promise.all([
      mediaWorker.close(),
      storageWorker.close(),
      integrationsWorker.close(),
      storageQueueForSchedules.close(),
      redis.quit(),
    ])
    process.exit(0)
  }

  process.on("SIGINT", () => {
    void shutdown()
  })
  process.on("SIGTERM", () => {
    void shutdown()
  })
}

start().catch((error) => {
  console.error(error)
  process.exit(1)
})
