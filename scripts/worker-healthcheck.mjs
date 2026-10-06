#!/usr/bin/env node
/**
 * Docker health probe for the worker (ARC-013, v1.1.4).
 *
 * Healthy only when the worker has written BOTH heartbeats recently:
 *   arciin:worker:heartbeat      — the process is alive and reaches Redis
 *   arciin:worker:heartbeat:db   — and its last `SELECT 1` against PostgreSQL
 *                                  succeeded
 *
 * A worker that reaches Redis but not the database would otherwise report
 * healthy while failing every job it takes.
 */
import Redis from "ioredis"

const MAX_AGE_MS = 60_000

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

const fresh = (raw) => {
  if (!raw) return false
  const ageMs = Date.now() - Number(raw)
  return Number.isFinite(ageMs) && ageMs <= MAX_AGE_MS
}

try {
  const [alive, db] = await redis.mget(heartbeatKey, `${heartbeatKey}:db`)
  await redis.quit()
  if (!fresh(alive)) {
    console.error("worker heartbeat missing or stale")
    process.exit(1)
  }
  if (!fresh(db)) {
    console.error("worker cannot reach PostgreSQL (database heartbeat stale)")
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
