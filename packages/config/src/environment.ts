/**
 * Development / production isolation.
 *
 * Arciin is developed on the same host it is served from, so a `pnpm dev`
 * stack and the PM2 production stack can collide on ports, the Postgres
 * database, the Redis/BullMQ queues, the storage root, and the Next build
 * directory. That collision is not theoretical: a development worker consumed
 * production upload jobs, and `next dev` overwrote the production
 * `apps/web/.next` BUILD_ID.
 *
 * Everything here is derived from one variable — `ARCIIN_ENV_NAMESPACE` — and
 * enforced by guards that refuse to start rather than silently sharing state.
 */

export const PRODUCTION_NAMESPACE = "production"
export const DEVELOPMENT_NAMESPACE = "dev"

export type EnvNamespace = string

/**
 * Values the production instance owns. A development process that resolves to
 * any of these is misconfigured and must refuse to start.
 */
export const PRODUCTION_RESOURCES = {
  databaseName: "arciin",
  redisDb: "0",
  dataDir: "/srv/arciin-storage/arciin",
  apiPort: 4000,
  webPort: 3002,
  nextDistDir: ".next",
  /** BullMQ's default key prefix. */
  queuePrefix: "bull",
} as const

/**
 * Resolve the namespace. Explicit wins; otherwise production only when
 * NODE_ENV says so, so an unset namespace in a dev shell is treated as dev
 * (the safe direction — it triggers the guards rather than bypassing them).
 */
export function resolveEnvNamespace(env: NodeJS.ProcessEnv = process.env): EnvNamespace {
  const explicit = env.ARCIIN_ENV_NAMESPACE?.trim()
  if (explicit) return explicit
  return env.NODE_ENV === "production" ? PRODUCTION_NAMESPACE : DEVELOPMENT_NAMESPACE
}

export function isProductionNamespace(namespace: EnvNamespace): boolean {
  return namespace === PRODUCTION_NAMESPACE
}

/**
 * BullMQ key prefix. Production keeps BullMQ's default `bull` so existing
 * queues and their retained jobs are untouched; every other namespace gets its
 * own prefix, which isolates queues, queue events, schedulers, and repeatable
 * jobs in one move.
 */
export function resolveQueuePrefix(
  namespace: EnvNamespace,
  override?: string | null,
): string {
  const explicit = override?.trim()
  if (explicit) return explicit
  return isProductionNamespace(namespace)
    ? PRODUCTION_RESOURCES.queuePrefix
    : `${PRODUCTION_RESOURCES.queuePrefix}-${namespace}`
}

/** Redis pub/sub channel carrying realtime events. */
export function resolveSocketChannel(
  namespace: EnvNamespace,
  baseChannel: string,
  override?: string | null,
): string {
  const explicit = override?.trim()
  if (explicit) return `${explicit}:${baseChannel}`
  return isProductionNamespace(namespace) ? baseChannel : `${namespace}:${baseChannel}`
}

/** Namespaced Redis key (worker heartbeat, rate limits, etc.). */
export function resolveNamespacedKey(namespace: EnvNamespace, key: string): string {
  return isProductionNamespace(namespace) ? key : `${namespace}:${key}`
}

export type IsolationInput = {
  namespace: EnvNamespace
  nodeEnv?: string
  databaseUrl?: string
  redisUrl?: string
  dataDir?: string
  apiPort?: number
  webPort?: number
  nextDistDir?: string
  queuePrefix?: string
}

function databaseName(url: string | undefined): string {
  if (!url) return ""
  try {
    return new URL(url).pathname.replace(/^\//, "")
  } catch {
    return ""
  }
}

function redisDbIndex(url: string | undefined): string {
  if (!url) return ""
  try {
    const path = new URL(url).pathname.replace(/^\//, "")
    return path === "" ? "0" : path
  } catch {
    return ""
  }
}

function normalizePath(value: string | undefined): string {
  return (value ?? "").replace(/\/+$/, "")
}

/**
 * Every way a non-production process could reach into production state.
 * Returns human-readable problems naming the exact offending setting — a guard
 * that just says "unsafe" costs more time than it saves.
 */
export function checkEnvironmentIsolation(input: IsolationInput): string[] {
  if (isProductionNamespace(input.namespace)) return []

  const problems: string[] = []

  const dbName = databaseName(input.databaseUrl)
  if (dbName === PRODUCTION_RESOURCES.databaseName) {
    problems.push(
      `DATABASE_URL points at the production database "${PRODUCTION_RESOURCES.databaseName}" — use a separate database such as "arciin_dev".`,
    )
  }

  const redisDb = redisDbIndex(input.redisUrl)
  if (redisDb === PRODUCTION_RESOURCES.redisDb) {
    problems.push(
      "REDIS_URL uses Redis database 0, which production owns — use a different database such as redis://127.0.0.1:6379/14.",
    )
  }

  if (normalizePath(input.dataDir) === PRODUCTION_RESOURCES.dataDir) {
    problems.push(
      `ARCIIN_DATA_DIR is the production storage root (${PRODUCTION_RESOURCES.dataDir}) — use a separate root such as /srv/arciin-storage/arciin-dev.`,
    )
  }

  const queuePrefix = input.queuePrefix?.trim()
  if (!queuePrefix) {
    problems.push("ARCIIN_QUEUE_PREFIX is missing — development queues must not share production keys.")
  } else if (queuePrefix === PRODUCTION_RESOURCES.queuePrefix) {
    problems.push(
      `ARCIIN_QUEUE_PREFIX is "${PRODUCTION_RESOURCES.queuePrefix}", the production prefix — a development worker would consume production jobs.`,
    )
  }

  if (input.apiPort === PRODUCTION_RESOURCES.apiPort) {
    problems.push(
      `API_PORT is ${PRODUCTION_RESOURCES.apiPort}, the production API port — use another port such as 4100.`,
    )
  }

  if (input.webPort === PRODUCTION_RESOURCES.webPort) {
    problems.push(
      `PORT is ${PRODUCTION_RESOURCES.webPort}, the production web port — use another port such as 3100.`,
    )
  }

  if (input.nextDistDir !== undefined && input.nextDistDir === PRODUCTION_RESOURCES.nextDistDir) {
    problems.push(
      `NEXT_DIST_DIR is "${PRODUCTION_RESOURCES.nextDistDir}" — running next dev would overwrite the production build. Use ".next-dev".`,
    )
  }

  if (input.nodeEnv === "production") {
    problems.push(
      `NODE_ENV is production but ARCIIN_ENV_NAMESPACE is "${input.namespace}" — the namespace and NODE_ENV disagree.`,
    )
  }

  return problems
}

export class UnsafeEnvironmentError extends Error {
  readonly problems: string[]

  constructor(problems: string[]) {
    super(
      [
        "Refusing to start: this development process would share state with production.",
        ...problems.map((problem) => `  • ${problem}`),
        "",
        "Run `pnpm dev:doctor` to see the full configuration, or start production with ARCIIN_ENV_NAMESPACE=production.",
      ].join("\n"),
    )
    this.name = "UnsafeEnvironmentError"
    this.problems = problems
  }
}

/** Throw unless this process is safely isolated. Production is always allowed. */
export function assertEnvironmentIsolation(input: IsolationInput): void {
  const problems = checkEnvironmentIsolation(input)
  if (problems.length > 0) throw new UnsafeEnvironmentError(problems)
}
