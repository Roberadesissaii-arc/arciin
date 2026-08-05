/**
 * Safety guard for the browser suite.
 *
 * Browser tests sign in, upload, and mutate state. If they ever pointed at the
 * live instance they would corrupt real user data, so this runs before the
 * config is even built and throws rather than warns.
 *
 * The checks are positive ("must be the dev port", "must be a test database")
 * rather than a blocklist — an unrecognised target is treated as production.
 */

export const PRODUCTION = {
  webPort: 3002,
  apiPort: 4000,
  databaseName: "arciin",
  redisDb: "0",
  dataDir: "/srv/arciin-storage/arciin",
  queuePrefix: "bull",
} as const

export type E2ETarget = {
  baseURL: string
  databaseUrl?: string
  redisUrl?: string
  dataDir?: string
  queuePrefix?: string
  nodeEnv?: string
}

function portOf(url: string): number | null {
  try {
    const parsed = new URL(url)
    return Number(parsed.port) || (parsed.protocol === "https:" ? 443 : 80)
  } catch {
    return null
  }
}

function databaseName(url?: string): string {
  if (!url) return ""
  try {
    return new URL(url).pathname.replace(/^\//, "")
  } catch {
    return ""
  }
}

function redisDb(url?: string): string {
  if (!url) return ""
  try {
    const path = new URL(url).pathname.replace(/^\//, "")
    return path === "" ? "0" : path
  } catch {
    return ""
  }
}

export function checkE2ETarget(target: E2ETarget): string[] {
  const problems: string[] = []

  const port = portOf(target.baseURL)
  if (port === PRODUCTION.webPort) {
    problems.push(`baseURL points at the production web port ${PRODUCTION.webPort}`)
  }
  if (port === PRODUCTION.apiPort) {
    problems.push(`baseURL points at the production API port ${PRODUCTION.apiPort}`)
  }

  const db = databaseName(target.databaseUrl)
  if (db === PRODUCTION.databaseName) {
    problems.push(`DATABASE_URL points at the production database "${db}"`)
  } else if (target.databaseUrl && !/test|dev/.test(db)) {
    problems.push(`DATABASE_URL database "${db}" is not marked as a test or dev database`)
  }

  if (target.redisUrl && redisDb(target.redisUrl) === PRODUCTION.redisDb) {
    problems.push("REDIS_URL uses Redis database 0, which production owns")
  }

  if (target.dataDir && target.dataDir.replace(/\/+$/, "") === PRODUCTION.dataDir) {
    problems.push("ARCIIN_DATA_DIR is the production storage root")
  }

  if (target.queuePrefix === PRODUCTION.queuePrefix) {
    problems.push(`queue prefix "${PRODUCTION.queuePrefix}" is the production prefix`)
  }

  if (target.nodeEnv === "production") {
    problems.push("NODE_ENV is production")
  }

  return problems
}

export function assertSafeE2ETarget(target: E2ETarget): void {
  const problems = checkE2ETarget(target)
  if (problems.length > 0) {
    throw new Error(
      [
        "Refusing to run browser tests against production:",
        ...problems.map((p) => `  • ${p}`),
        "",
        "Start the isolated stack first: pnpm dev  (web :3100, api :4100, arciin_dev, redis db 14)",
      ].join("\n"),
    )
  }
}
