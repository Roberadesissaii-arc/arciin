import { setInterval } from "node:timers"

import { Worker } from "bullmq"
import Redis from "ioredis"

import { JOB_QUEUE_NAMES, JOB_TYPES, WORKER_HEARTBEAT_KEY } from "@arciin/shared"

import { workerConfig } from "@/config"
import {
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
  const redis = new Redis(workerConfig.REDIS_URL, {
    maxRetriesPerRequest: null,
  })

  const heartbeat = setInterval(() => {
    void redis.set(WORKER_HEARTBEAT_KEY, String(Date.now()))
  }, 15_000)

  await redis.set(WORKER_HEARTBEAT_KEY, String(Date.now()))

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
        throw error
      }
    },
    {
      connection,
      // Bound heavy media work (transcodes/imports) so a burst can't exhaust
      // CPU/RAM and starve thumbnailing for everyone.
      concurrency: workerConfig.ARCIIN_WORKER_CONCURRENCY,
      limiter: { max: workerConfig.ARCIIN_WORKER_CONCURRENCY * 2, duration: 60_000 },
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
    { connection }
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
    { connection }
  )

  const shutdown = async () => {
    clearInterval(heartbeat)
    clearInterval(autoUpdateCheck)
    await Promise.all([
      mediaWorker.close(),
      storageWorker.close(),
      integrationsWorker.close(),
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
