/**
 * Safety guard for the integration suite.
 *
 * Integration tests write and delete rows. If they ever pointed at the live
 * instance they would corrupt real user data, so every entry point calls
 * `assertIsolatedTestEnvironment()` first and the process aborts on any doubt.
 * The checks are deliberately positive ("the name must contain _test") rather
 * than a blocklist — an unrecognised URL is treated as production.
 */

export type IsolationConfig = {
  databaseUrl: string
  redisUrl: string
  dataDir: string
  nodeEnv: string | undefined
}

export class UnsafeTestEnvironmentError extends Error {
  constructor(message: string) {
    super(`Refusing to run integration tests: ${message}`)
    this.name = "UnsafeTestEnvironmentError"
  }
}

/** Production values this instance must never be pointed at by a test. */
export const PRODUCTION_MARKERS = {
  databaseName: "arciin",
  redisDb: "0",
  dataDir: "/srv/arciin-storage/arciin",
}

function databaseName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "")
  } catch {
    return ""
  }
}

function redisDbIndex(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/^\//, "")
    return path === "" ? "0" : path
  } catch {
    return "0"
  }
}

export function checkIsolation(config: IsolationConfig): string[] {
  const problems: string[] = []

  if (config.nodeEnv === "production") {
    problems.push("NODE_ENV is production")
  }

  const dbName = databaseName(config.databaseUrl)
  if (!dbName) {
    problems.push("DATABASE_URL is unparseable")
  } else if (dbName === PRODUCTION_MARKERS.databaseName) {
    problems.push(`DATABASE_URL points at the production database "${dbName}"`)
  } else if (!dbName.includes("test")) {
    problems.push(`DATABASE_URL database "${dbName}" is not marked as a test database`)
  }

  const redisDb = redisDbIndex(config.redisUrl)
  if (redisDb === PRODUCTION_MARKERS.redisDb) {
    problems.push("REDIS_URL uses database 0, which production uses")
  }

  const dataDir = config.dataDir?.replace(/\/+$/, "") ?? ""
  if (!dataDir) {
    problems.push("ARCIIN_DATA_DIR is empty")
  } else if (dataDir === PRODUCTION_MARKERS.dataDir) {
    problems.push("ARCIIN_DATA_DIR is the production storage root")
  } else if (!dataDir.startsWith("/tmp/")) {
    problems.push(`ARCIIN_DATA_DIR "${dataDir}" is outside /tmp`)
  }

  return problems
}

export function assertIsolatedTestEnvironment(
  config: IsolationConfig = {
    databaseUrl: process.env.DATABASE_URL ?? "",
    redisUrl: process.env.REDIS_URL ?? "",
    dataDir: process.env.ARCIIN_DATA_DIR ?? "",
    nodeEnv: process.env.NODE_ENV,
  },
): void {
  const problems = checkIsolation(config)
  if (problems.length > 0) {
    throw new UnsafeTestEnvironmentError(problems.join("; "))
  }
}
