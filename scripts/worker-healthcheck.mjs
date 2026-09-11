#!/usr/bin/env node
/**
 * Docker health probe for the worker (ARC-013).
 *
 * Exits 0 when a fresh worker heartbeat exists in Redis; non-zero otherwise.
 */
import Redis from "ioredis"

const redisUrl = process.env.REDIS_URL
if (!redisUrl) {
  console.error("REDIS_URL is not set")
  process.exit(2)
}

const namespace = (process.env.ARCIIN_ENV_NAMESPACE ?? "production").trim()
const baseKey = "arciin:worker:heartbeat"
const heartbeatKey =
  namespace === "production" ? baseKey : `${namespace}:${baseKey}`

const redis = new Redis(redisUrl, {
  connectTimeout: 3_000,
  commandTimeout: 3_000,
  maxRetriesPerRequest: 1,
})

try {
  const raw = await redis.get(heartbeatKey)
  await redis.quit()
  if (!raw) {
    process.exit(1)
  }
  const ageMs = Date.now() - Number(raw)
  if (!Number.isFinite(ageMs) || ageMs > 60_000) {
    process.exit(1)
  }
  process.exit(0)
} catch {
  try {
    await redis.quit()
  } catch {
    /* ignore */
  }
  process.exit(1)
}
