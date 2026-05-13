import { setInterval } from "node:timers"

import { Worker } from "bullmq"
import Redis from "ioredis"

import { JOB_QUEUE_NAMES, WORKER_HEARTBEAT_KEY } from "@arciin/shared"

import { workerConfig } from "@/config"
import {
  handleIntegrationJob,
  handleMediaJob,
  handleStorageJob,
  markJobFailure,
} from "@/processors/worker-handlers"

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
        await handleMediaJob(job.name, job.data, redis)
      } catch (error) {
        await markJobFailure(job.data.jobRecordId, error)
        throw error
      }
    },
    { connection }
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
