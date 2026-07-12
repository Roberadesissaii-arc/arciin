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
import { handleImportUrl } from "@/services/url-import"

const redisUrl = new URL(workerConfig.REDIS_URL)

const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: redisUrl.pathname ? Number(redisUrl.pathname.slice(1)) || 0 : 0,
  tls: redisUrl.protocol === "rediss:" ? {} : undefined,
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
        await handleStorageJob(job.name, job.data)
      } catch (error) {
        await markJobFailure(job.data.jobRecordId, error)
        throw error
      }
    },
    { connection }
  )

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
