import { Queue } from "bullmq"

import { JOB_QUEUE_NAMES } from "@arciin/shared"

import { apiConfig } from "@/config"

const redisUrl = new URL(apiConfig.REDIS_URL)

const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: redisUrl.pathname ? Number(redisUrl.pathname.slice(1)) || 0 : 0,
  tls: redisUrl.protocol === "rediss:" ? {} : undefined,
}

export const mediaQueue = new Queue(JOB_QUEUE_NAMES.media, { connection })
export const storageQueue = new Queue(JOB_QUEUE_NAMES.storage, { connection })
export const integrationsQueue = new Queue(JOB_QUEUE_NAMES.integrations, { connection })
