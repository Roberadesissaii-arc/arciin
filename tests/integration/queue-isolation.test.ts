import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { Queue, Worker } from "bullmq"
import Redis from "ioredis"

import { resolveQueuePrefix } from "@arciin/config"

import { assertIsolatedTestEnvironment } from "./guard"

/**
 * Proves BullMQ prefixes actually separate the two instances.
 *
 * This is the defect that mattered most: a development worker sharing Redis
 * db 0 and the `bull` prefix silently consumed real users' upload jobs. The
 * assertion is symmetric — neither side may see the other's work.
 *
 * Runs against the isolated test Redis db, never production.
 */

assertIsolatedTestEnvironment()

const QUEUE_NAME = "media"
const PRODUCTION_PREFIX = resolveQueuePrefix("production")
const DEV_PREFIX = resolveQueuePrefix("dev")

let connection: Redis
let productionQueue: Queue
let devQueue: Queue

beforeAll(() => {
  connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null })
  productionQueue = new Queue(QUEUE_NAME, { connection, prefix: PRODUCTION_PREFIX })
  devQueue = new Queue(QUEUE_NAME, { connection, prefix: DEV_PREFIX })
})

afterAll(async () => {
  await productionQueue.obliterate({ force: true }).catch(() => {})
  await devQueue.obliterate({ force: true }).catch(() => {})
  await productionQueue.close()
  await devQueue.close()
  await connection.quit()
})

/** Run a worker on `prefix` briefly and return the job names it consumed. */
async function collectWith(prefix: string, timeoutMs = 1_500): Promise<string[]> {
  const seen: string[] = []
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      seen.push(String(job.data?.marker ?? job.name))
    },
    { connection: { url: process.env.REDIS_URL! }, prefix },
  )

  await new Promise((resolve) => setTimeout(resolve, timeoutMs))
  await worker.close()
  return seen
}

describe("BullMQ prefix isolation", () => {
  it("uses different prefixes for production and development", () => {
    expect(PRODUCTION_PREFIX).toBe("bull")
    expect(DEV_PREFIX).toBe("bull-dev")
    expect(PRODUCTION_PREFIX).not.toBe(DEV_PREFIX)
  })

  it("a development worker cannot consume a production job", async () => {
    await productionQueue.add("extract_metadata", { marker: "production-job" })

    const consumed = await collectWith(DEV_PREFIX)

    expect(consumed).not.toContain("production-job")
    // And the job is still waiting for its real owner.
    expect(await productionQueue.getWaitingCount()).toBe(1)
  })

  it("a production worker cannot consume a development job", async () => {
    await devQueue.add("extract_metadata", { marker: "dev-job" })

    const consumed = await collectWith(PRODUCTION_PREFIX)

    expect(consumed).not.toContain("dev-job")
    expect(await devQueue.getWaitingCount()).toBe(1)
  })

  it("a worker on the matching prefix does consume its own job", async () => {
    // Guards against the opposite failure: a prefix so isolated that the real
    // worker never sees anything either.
    const consumed = await collectWith(DEV_PREFIX, 2_000)

    expect(consumed).toContain("dev-job")
    expect(await devQueue.getWaitingCount()).toBe(0)
  })

  it("keeps the two queues in separate Redis keyspaces", async () => {
    const productionKeys = await connection.keys(`${PRODUCTION_PREFIX}:${QUEUE_NAME}:*`)
    const devKeys = await connection.keys(`${DEV_PREFIX}:${QUEUE_NAME}:*`)

    expect(productionKeys.length).toBeGreaterThan(0)
    expect(devKeys.length).toBeGreaterThan(0)
    expect(productionKeys.some((key) => devKeys.includes(key))).toBe(false)
  })
})
