import Fastify, { type FastifyInstance } from "fastify"
import { mkdir } from "node:fs/promises"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { apiConfig } from "../../apps/api/src/config"
import { isExempt } from "../../apps/api/src/plugins/api-protection"
import { registerHealthRoutes } from "../../apps/api/src/routes/health.routes"

/**
 * ARC-003 — health has to be readable by a supervisor, not just by a human.
 *
 * With PostgreSQL stopped this endpoint answered HTTP 200 and a body saying
 * `database: offline`. The Docker healthcheck tests `r.ok`, so Docker reported
 * the API healthy while every authenticated request returned 500. On an
 * appliance with no console that is the difference between a visible outage
 * and a silent one.
 *
 * The body was never the problem. These tests pin the status code to the same
 * truth the body already told, and pin the boundary of what counts as critical.
 */

type Stub = {
  databaseOk?: boolean
  redisOk?: boolean
  storageOk?: boolean
  /** Milliseconds a dependency takes to answer. Used to prove probes are bounded. */
  redisDelayMs?: number
  heartbeatAgeMs?: number | null
}

let app: FastifyInstance | null = null

/** The suite's storage root, which the probe checks for real. */
const REAL_DATA_DIR = apiConfig.dataDir
const MISSING_DATA_DIR = "/tmp/arciin-storage-that-is-not-there"

beforeAll(async () => {
  await mkdir(REAL_DATA_DIR, { recursive: true })
})

async function buildApp(stub: Stub = {}) {
  const {
    databaseOk = true,
    redisOk = true,
    storageOk = true,
    redisDelayMs = 0,
    heartbeatAgeMs = 0,
  } = stub

  const instance = Fastify({ logger: false })

  instance.decorate("prisma", {
    $queryRaw: async () => {
      if (!databaseOk) throw new Error("connect ECONNREFUSED")
      return [{ "?column?": 1 }]
    },
  } as never)

  const redisCall = async <T>(value: T): Promise<T> => {
    if (redisDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, redisDelayMs))
    if (!redisOk) throw new Error("Connection is closed.")
    return value
  }

  instance.decorate("redis", {
    ping: () => redisCall("PONG"),
    get: () =>
      redisCall(heartbeatAgeMs === null ? null : String(Date.now() - heartbeatAgeMs)),
  } as never)

  // The storage probe calls access() for real, so point it at a path that
  // genuinely does or does not exist rather than stubbing the filesystem.
  apiConfig.dataDir = storageOk ? REAL_DATA_DIR : MISSING_DATA_DIR

  await instance.register(registerHealthRoutes)
  await instance.ready()
  app = instance
  return instance
}

afterEach(async () => {
  await app?.close()
  app = null
  apiConfig.dataDir = REAL_DATA_DIR
})

async function getHealth(stub: Stub = {}) {
  const instance = await buildApp(stub)
  const res = await instance.inject({ method: "GET", url: "/health" })
  return { status: res.statusCode, body: res.json().data as Record<string, unknown> }
}

describe("a fully operational instance", () => {
  it("answers 200 and reports every service online", async () => {
    const { status, body } = await getHealth()
    expect(status).toBe(200)
    expect(body).toMatchObject({
      api: "online",
      database: "online",
      redis: "online",
      storage: "online",
      status: "ready",
    })
  })
})

describe("PostgreSQL is down", () => {
  it("answers 503 so the Docker healthcheck fails", async () => {
    const { status } = await getHealth({ databaseOk: false })
    expect(status).toBe(503)
  })

  it("still says which service is at fault", async () => {
    const { body } = await getHealth({ databaseOk: false })
    expect(body).toMatchObject({
      api: "online",
      database: "offline",
      redis: "online",
      status: "degraded",
    })
  })
})

describe("Redis is down", () => {
  it("answers 503 rather than hanging", async () => {
    const started = Date.now()
    const { status, body } = await getHealth({ redisOk: false })
    expect(status).toBe(503)
    expect(body).toMatchObject({ redis: "offline", realtime: "offline", worker: "offline" })
    // ARC-002: this request used to never return at all.
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})

describe("storage is unreachable", () => {
  it("answers 503, because the files are the product", async () => {
    const { status, body } = await getHealth({ storageOk: false })
    expect(status).toBe(503)
    expect(body).toMatchObject({ storage: "offline" })
  })
})

describe("a dependency that stalls instead of failing", () => {
  it("still answers, bounded by the probe deadline", async () => {
    const started = Date.now()
    // Longer than the probe deadline: the route must give up on it, not wait.
    const { status, body } = await getHealth({ redisDelayMs: 30_000 })
    expect(status).toBe(503)
    expect(body).toMatchObject({ redis: "offline" })
    expect(Date.now() - started).toBeLessThan(10_000)
  }, 20_000)
})

describe("the worker", () => {
  it("does not make the API unhealthy when it is missing", async () => {
    // A fresh install has never written a heartbeat. That is not an API fault,
    // and the worker runs in its own container with its own healthcheck.
    const { status, body } = await getHealth({ heartbeatAgeMs: null })
    expect(status).toBe(200)
    expect(body).toMatchObject({ worker: "unknown", status: "ready" })
  })

  it("is reported offline when its heartbeat has gone stale", async () => {
    const { status, body } = await getHealth({ heartbeatAgeMs: 5 * 60_000 })
    expect(status).toBe(200)
    expect(body).toMatchObject({ worker: "offline" })
  })

  it("is reported online when the heartbeat is fresh", async () => {
    const { body } = await getHealth({ heartbeatAgeMs: 1_000 })
    expect(body).toMatchObject({ worker: "online" })
  })
})

describe("liveness is separate from readiness", () => {
  it("stays 200 while dependencies are down", async () => {
    // Restarting the API cannot fix a stopped database. A supervisor that
    // conflates the two turns a recoverable outage into a crash loop.
    const instance = await buildApp({ databaseOk: false, redisOk: false, storageOk: false })
    const res = await instance.inject({ method: "GET", url: "/health/live" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ api: "online" })
  })

  it("is exempt from the protection hook, which itself needs the database", () => {
    /**
     * Found by fault injection, not by reading the code. The hook loads its
     * settings from PostgreSQL, and its exemption list matched `/api/health`
     * exactly — so `/api/health/live` ran through it and answered 500 during
     * precisely the outage it exists to survive.
     */
    expect(isExempt("/api/health/live")).toBe(true)
    expect(isExempt("/api/health")).toBe(true)
    // Still a list of specific exemptions, not a prefix free-for-all.
    expect(isExempt("/api/assets")).toBe(false)
    expect(isExempt("/api/health-summary")).toBe(false)
  })
})
