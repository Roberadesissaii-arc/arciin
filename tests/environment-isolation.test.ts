import { describe, expect, it } from "vitest"

import {
  DEVELOPMENT_NAMESPACE,
  PRODUCTION_NAMESPACE,
  PRODUCTION_RESOURCES,
  UnsafeEnvironmentError,
  assertEnvironmentIsolation,
  checkEnvironmentIsolation,
  isProductionNamespace,
  resolveEnvNamespace,
  resolveNamespacedKey,
  resolveQueuePrefix,
  resolveSocketChannel,
} from "@arciin/config"

/**
 * Development/production isolation.
 *
 * A development worker consumed production upload jobs and `next dev`
 * overwrote the production BUILD_ID, because both stacks shared Redis db 0,
 * the `bull` queue prefix, the storage root and `.next`. These cases pin every
 * guard that now prevents that.
 */

/** A correctly isolated development configuration. */
const safeDev = {
  namespace: DEVELOPMENT_NAMESPACE,
  nodeEnv: "development",
  databaseUrl: "postgresql://u:p@localhost:5432/arciin_dev",
  redisUrl: "redis://127.0.0.1:6379/14",
  dataDir: "/srv/arce-projects/arciin-dev-storage",
  apiPort: 4100,
  webPort: 3100,
  nextDistDir: ".next-dev",
  queuePrefix: "bull-dev",
}

describe("resolveEnvNamespace", () => {
  it("prefers an explicit namespace", () => {
    expect(resolveEnvNamespace({ ARCIIN_ENV_NAMESPACE: "dev" } as NodeJS.ProcessEnv)).toBe("dev")
    expect(
      resolveEnvNamespace({
        ARCIIN_ENV_NAMESPACE: "production",
        NODE_ENV: "development",
      } as NodeJS.ProcessEnv),
    ).toBe("production")
  })

  it("falls back to production only when NODE_ENV says so", () => {
    expect(resolveEnvNamespace({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(
      PRODUCTION_NAMESPACE,
    )
  })

  it("defaults to dev when nothing is set — the safe direction", () => {
    // An unset namespace must trigger the guards, never bypass them.
    expect(resolveEnvNamespace({} as NodeJS.ProcessEnv)).toBe(DEVELOPMENT_NAMESPACE)
  })
})

describe("derived namespacing", () => {
  it("leaves production on BullMQ's default prefix so existing queues are untouched", () => {
    expect(resolveQueuePrefix(PRODUCTION_NAMESPACE)).toBe(PRODUCTION_RESOURCES.queuePrefix)
  })

  it("gives every other namespace its own queue prefix", () => {
    expect(resolveQueuePrefix("dev")).toBe("bull-dev")
    expect(resolveQueuePrefix("staging")).toBe("bull-staging")
  })

  it("honours an explicit prefix override", () => {
    expect(resolveQueuePrefix("dev", "custom")).toBe("custom")
  })

  it("namespaces the realtime channel and shared Redis keys outside production", () => {
    expect(resolveSocketChannel(PRODUCTION_NAMESPACE, "arciin:events")).toBe("arciin:events")
    expect(resolveSocketChannel("dev", "arciin:events")).toBe("dev:arciin:events")
    expect(resolveNamespacedKey(PRODUCTION_NAMESPACE, "arciin:worker:heartbeat")).toBe(
      "arciin:worker:heartbeat",
    )
    expect(resolveNamespacedKey("dev", "arciin:worker:heartbeat")).toBe(
      "dev:arciin:worker:heartbeat",
    )
  })

  it("recognises the production namespace", () => {
    expect(isProductionNamespace(PRODUCTION_NAMESPACE)).toBe(true)
    expect(isProductionNamespace("dev")).toBe(false)
  })
})

describe("checkEnvironmentIsolation", () => {
  it("accepts a correctly isolated development configuration", () => {
    expect(checkEnvironmentIsolation(safeDev)).toEqual([])
  })

  it("never blocks production, whatever it points at", () => {
    // Production legitimately uses all of these.
    expect(
      checkEnvironmentIsolation({
        namespace: PRODUCTION_NAMESPACE,
        nodeEnv: "production",
        databaseUrl: `postgresql://u:p@localhost:5432/${PRODUCTION_RESOURCES.databaseName}`,
        redisUrl: "redis://127.0.0.1:6379/0",
        dataDir: PRODUCTION_RESOURCES.dataDir,
        apiPort: PRODUCTION_RESOURCES.apiPort,
        webPort: PRODUCTION_RESOURCES.webPort,
        nextDistDir: PRODUCTION_RESOURCES.nextDistDir,
        queuePrefix: PRODUCTION_RESOURCES.queuePrefix,
      }),
    ).toEqual([])
  })

  it("rejects a dev process pointed at the production database", () => {
    const problems = checkEnvironmentIsolation({
      ...safeDev,
      databaseUrl: `postgresql://u:p@localhost:5432/${PRODUCTION_RESOURCES.databaseName}`,
    })
    expect(problems.join(" ")).toMatch(/production database "arciin"/)
  })

  it("rejects Redis database 0", () => {
    expect(
      checkEnvironmentIsolation({ ...safeDev, redisUrl: "redis://127.0.0.1:6379/0" }).join(" "),
    ).toMatch(/Redis database 0/)
    // No path also means db 0.
    expect(
      checkEnvironmentIsolation({ ...safeDev, redisUrl: "redis://127.0.0.1:6379" }).join(" "),
    ).toMatch(/Redis database 0/)
  })

  it("rejects the production storage root", () => {
    expect(
      checkEnvironmentIsolation({ ...safeDev, dataDir: PRODUCTION_RESOURCES.dataDir }).join(" "),
    ).toMatch(/production storage root/)
    // Trailing slashes must not defeat the check.
    expect(
      checkEnvironmentIsolation({
        ...safeDev,
        dataDir: `${PRODUCTION_RESOURCES.dataDir}/`,
      }).join(" "),
    ).toMatch(/production storage root/)
  })

  it("rejects a missing queue prefix", () => {
    expect(checkEnvironmentIsolation({ ...safeDev, queuePrefix: undefined }).join(" ")).toMatch(
      /ARCIIN_QUEUE_PREFIX is missing/,
    )
    expect(checkEnvironmentIsolation({ ...safeDev, queuePrefix: "   " }).join(" ")).toMatch(
      /ARCIIN_QUEUE_PREFIX is missing/,
    )
  })

  it("rejects the production queue prefix — the defect that leaked jobs", () => {
    expect(
      checkEnvironmentIsolation({
        ...safeDev,
        queuePrefix: PRODUCTION_RESOURCES.queuePrefix,
      }).join(" "),
    ).toMatch(/would consume production jobs/)
  })

  it("rejects binding the production API port", () => {
    expect(
      checkEnvironmentIsolation({ ...safeDev, apiPort: PRODUCTION_RESOURCES.apiPort }).join(" "),
    ).toMatch(/production API port/)
  })

  it("rejects binding the production web port", () => {
    expect(
      checkEnvironmentIsolation({ ...safeDev, webPort: PRODUCTION_RESOURCES.webPort }).join(" "),
    ).toMatch(/production web port/)
  })

  it("rejects writing to the production Next output directory", () => {
    expect(
      checkEnvironmentIsolation({
        ...safeDev,
        nextDistDir: PRODUCTION_RESOURCES.nextDistDir,
      }).join(" "),
    ).toMatch(/overwrite the production build/)
  })

  it("rejects NODE_ENV=production under a development namespace", () => {
    expect(checkEnvironmentIsolation({ ...safeDev, nodeEnv: "production" }).join(" ")).toMatch(
      /NODE_ENV is production/,
    )
  })

  it("reports every problem at once, so one restart shows the full picture", () => {
    const problems = checkEnvironmentIsolation({
      namespace: DEVELOPMENT_NAMESPACE,
      nodeEnv: "production",
      databaseUrl: "postgresql://u:p@localhost:5432/arciin",
      redisUrl: "redis://127.0.0.1:6379/0",
      dataDir: PRODUCTION_RESOURCES.dataDir,
      apiPort: 4000,
      webPort: 3002,
      nextDistDir: ".next",
      queuePrefix: "bull",
    })
    expect(problems).toHaveLength(8)
  })
})

describe("assertEnvironmentIsolation", () => {
  it("passes silently when isolated", () => {
    expect(() => assertEnvironmentIsolation(safeDev)).not.toThrow()
  })

  it("throws an error naming the offending settings", () => {
    let caught: unknown
    try {
      assertEnvironmentIsolation({ ...safeDev, redisUrl: "redis://127.0.0.1:6379/0" })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(UnsafeEnvironmentError)
    const message = (caught as Error).message
    expect(message).toMatch(/Refusing to start/)
    expect(message).toMatch(/Redis database 0/)
    // The operator needs to know how to inspect it.
    expect(message).toMatch(/dev:doctor/)
  })
})
