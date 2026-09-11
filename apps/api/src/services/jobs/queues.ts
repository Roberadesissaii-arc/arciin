import { Queue } from "bullmq"

import {
  DEFAULT_MEDIA_JOB_OPTIONS,
  JOB_QUEUE_NAMES,
  REDIS_COMMAND_TIMEOUT_MS,
  REDIS_CONNECT_TIMEOUT_MS,
} from "@arciin/shared"

import { apiConfig } from "@/config"

const redisUrl = new URL(apiConfig.REDIS_URL)

const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: redisUrl.pathname ? Number(redisUrl.pathname.slice(1)) || 0 : 0,
  tls: redisUrl.protocol === "rediss:" ? {} : undefined,
  // Required by BullMQ for any connection it manages — see apps/worker/src/index.ts.
  maxRetriesPerRequest: null as null,
  /**
   * These are producers, never workers.
   *
   * `maxRetriesPerRequest: null` is what keeps a *worker's* blocking job-fetch
   * from being cancelled, but nothing here blocks — these queues only ever
   * `add()`. Without a deadline that setting made enqueueing wait forever
   * whenever Redis was down, which is what hung uploads (ARC-002): the outbox
   * was ready to defer the job, but `queue.add()` never returned to tell it to.
   *
   * A rejection is all the outbox needs; the row stays PENDING and the
   * reconciler dispatches it once Redis is back.
   */
  connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
  commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
}

// Retry budget and Redis retention are set once here so every producer
// inherits them — see DEFAULT_MEDIA_JOB_OPTIONS for why.
const defaultJobOptions = DEFAULT_MEDIA_JOB_OPTIONS

// `prefix` is what isolates dev from production: it namespaces every BullMQ
// key — jobs, queue events, schedulers and repeatable jobs — in one setting.
const prefix = apiConfig.queuePrefix

export const mediaQueue = new Queue(JOB_QUEUE_NAMES.media, {
  connection,
  defaultJobOptions,
  prefix,
})
export const storageQueue = new Queue(JOB_QUEUE_NAMES.storage, {
  connection,
  defaultJobOptions,
  prefix,
})
export const integrationsQueue = new Queue(JOB_QUEUE_NAMES.integrations, {
  connection,
  defaultJobOptions,
  prefix,
})
