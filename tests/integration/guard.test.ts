import { describe, expect, it } from "vitest"

import { checkIsolation, assertIsolatedTestEnvironment, PRODUCTION_MARKERS } from "./guard"

/**
 * The guard is the only thing standing between a destructive integration run
 * and real user data, so it is tested first and hardest.
 */

const safe = {
  databaseUrl: "postgresql://u:p@localhost:5432/arciin_test",
  redisUrl: "redis://127.0.0.1:6379/15",
  dataDir: "/tmp/arciin-integration-storage",
  nodeEnv: "test",
}

describe("integration environment guard", () => {
  it("accepts a fully isolated environment", () => {
    expect(checkIsolation(safe)).toEqual([])
  })

  it("rejects the production database", () => {
    const problems = checkIsolation({
      ...safe,
      databaseUrl: `postgresql://u:p@localhost:5432/${PRODUCTION_MARKERS.databaseName}`,
    })
    expect(problems.join(" ")).toMatch(/production database/)
  })

  it("rejects any database not marked as a test database", () => {
    const problems = checkIsolation({
      ...safe,
      databaseUrl: "postgresql://u:p@localhost:5432/something_else",
    })
    expect(problems.join(" ")).toMatch(/not marked as a test database/)
  })

  it("rejects production Redis db 0", () => {
    expect(
      checkIsolation({ ...safe, redisUrl: "redis://127.0.0.1:6379/0" }).join(" "),
    ).toMatch(/database 0/)
    // A URL with no db path also means db 0.
    expect(checkIsolation({ ...safe, redisUrl: "redis://127.0.0.1:6379" }).join(" ")).toMatch(
      /database 0/,
    )
  })

  it("rejects the production storage root", () => {
    expect(
      checkIsolation({ ...safe, dataDir: PRODUCTION_MARKERS.dataDir }).join(" "),
    ).toMatch(/production storage root/)
  })

  it("rejects any storage root outside /tmp", () => {
    expect(checkIsolation({ ...safe, dataDir: "/srv/somewhere-else" }).join(" ")).toMatch(
      /outside \/tmp/,
    )
  })

  it("rejects NODE_ENV=production", () => {
    expect(checkIsolation({ ...safe, nodeEnv: "production" }).join(" ")).toMatch(
      /NODE_ENV is production/,
    )
  })

  it("throws when the live environment is unsafe", () => {
    expect(() =>
      assertIsolatedTestEnvironment({
        databaseUrl: "postgresql://u:p@localhost:5432/arciin",
        redisUrl: "redis://127.0.0.1:6379/0",
        dataDir: PRODUCTION_MARKERS.dataDir,
        nodeEnv: "production",
      }),
    ).toThrow(/Refusing to run integration tests/)
  })

  it("confirms the environment this suite is actually running in is isolated", () => {
    expect(() => assertIsolatedTestEnvironment()).not.toThrow()
    expect(process.env.DATABASE_URL).toContain("arciin_test")
    expect(process.env.DATABASE_URL).not.toMatch(/\/arciin(\?|$)/)
  })
})
