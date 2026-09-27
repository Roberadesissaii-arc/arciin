import { access } from "node:fs/promises"

import type { FastifyInstance } from "fastify"

import { REDIS_COMMAND_TIMEOUT_MS } from "@arciin/shared"

import { apiConfig } from "@/config"
import { requireSessionRole } from "@/services/security/auth"

/**
 * Every probe gets its own deadline.
 *
 * The Redis client already bounds its own commands, but Prisma does not, and
 * `access()` can stall on a wedged network mount. A health endpoint that can
 * hang is worse than no health endpoint: during the Redis outage in the audit
 * this route stopped answering entirely, so the one thing that could have
 * reported the fault was the thing the fault silenced (ARC-002).
 */
const PROBE_TIMEOUT_MS = REDIS_COMMAND_TIMEOUT_MS + 1_000

async function probe(check: () => Promise<unknown>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      check(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("probe timed out")), PROBE_TIMEOUT_MS)
      }),
    ])
    return true
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type HealthDetail = {
  api: "online"
  database: "online" | "offline"
  redis: "online" | "offline"
  realtime: "online" | "offline"
  worker: "online" | "offline" | "unknown"
  storage: "online" | "offline"
  status: "ready" | "degraded"
  version: string
  timestamp: string
}

/**
 * The full picture, in one place.
 *
 * The public endpoint reduces this to a word and the authenticated one sends
 * it whole, so there is no second implementation to drift.
 */
export async function computeHealth(fastify: FastifyInstance): Promise<HealthDetail> {
  const [databaseOk, storageOk] = await Promise.all([
    probe(() => fastify.prisma.$queryRaw`SELECT 1`),
    probe(() => access(apiConfig.dataDir)),
  ])
  const redisOk = await probe(() => fastify.redis.ping())

  let worker: "online" | "offline" | "unknown" = redisOk ? "unknown" : "offline"
  if (redisOk) {
    const heartbeat = await fastify.redis.get(apiConfig.workerHeartbeatKey).catch(() => null)
    if (heartbeat) {
      worker = Date.now() - Number(heartbeat) < 60_000 ? "online" : "offline"
    }
  }

  const ready = databaseOk && redisOk && storageOk
  return {
    api: "online",
    database: databaseOk ? "online" : "offline",
    redis: redisOk ? "online" : "offline",
    realtime: redisOk ? "online" : "offline",
    worker,
    storage: storageOk ? "online" : "offline",
    status: ready ? "ready" : "degraded",
    version: apiConfig.appVersion,
    timestamp: new Date().toISOString(),
  }
}

export async function registerHealthRoutes(fastify: FastifyInstance) {
  /**
   * Liveness: is this process running and able to answer?
   *
   * Separate from readiness because the correct response to each is opposite.
   * Restarting the API fixes a wedged process; it does nothing for a stopped
   * database, and a supervisor that restarts on dependency failure turns a
   * recoverable outage into a crash loop. Nothing here touches a dependency.
   */
  fastify.get("/health/live", async (_request, reply) => {
    reply.send({
      data: {
        api: "online",
        version: apiConfig.appVersion,
        timestamp: new Date().toISOString(),
      },
    })
  })

  /**
   * Readiness: can this instance actually serve requests?
   *
   * This used to answer 200 no matter what it found, so a stopped PostgreSQL
   * was reported as healthy while every authenticated request returned 500 —
   * and because the Docker healthcheck tests `r.ok`, Docker agreed (ARC-003).
   * The body was honest all along; only the status code lied.
   *
   * Critical means "requests fail without it": the database backs every route,
   * Redis gates sign-in and job dispatch, and storage is where the files are.
   * The worker is reported but deliberately not critical — it runs in its own
   * container, its work is queued durably by the outbox, and marking the API
   * unhealthy because a *different* service is down would point an operator at
   * the wrong thing. A never-started worker also reports "unknown", which must
   * not make a fresh install look broken.
   */
  fastify.get("/health", async (_request, reply) => {
    const detail = await computeHealth(fastify)
    /**
     * Deliberately minimal for an unauthenticated caller.
     *
     * This used to answer with the exact version, which subsystems existed and
     * whether each was up, plus a server timestamp — a free and accurate
     * inventory to anyone who could reach the port.
     *
     * The status code still carries the same truth it always did: a supervisor
     * reads the code, not the body, and that is what ARC-003 pinned.
     */
    reply.status(detail.status === "ready" ? 200 : 503).send({
      data: { status: detail.status === "ready" ? "ok" : "degraded" },
    })
  })

  /**
   * The detailed view the public endpoint used to give away, for the owner.
   */
  fastify.get(
    "/health/detailed",
    { preHandler: requireSessionRole(["OWNER", "ADMIN"]) },
    async (_request, reply) => {
      reply.status(200).send({ data: await computeHealth(fastify) })
    },
  )
}
