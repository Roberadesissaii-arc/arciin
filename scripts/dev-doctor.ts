/**
 * `pnpm dev:doctor` — report whether the development configuration is safely
 * isolated from production, with secrets redacted.
 *
 * Exits non-zero if development could interfere with production, so it can be
 * used as a pre-flight check in a shell or CI step.
 */
import path from "node:path"
import { access } from "node:fs/promises"

import {
  PRODUCTION_RESOURCES,
  checkEnvironmentIsolation,
  isProductionNamespace,
  loadArciinEnv,
  resolveEnvNamespace,
  resolveQueuePrefix,
  resolveSocketChannel,
} from "@arciin/config"
import { SOCKET_EVENT_CHANNEL } from "@arciin/config"

const repoRoot = path.resolve(__dirname, "..")

function databaseName(url: string | undefined): string {
  if (!url) return "(unset)"
  try {
    return new URL(url).pathname.replace(/^\//, "") || "(none)"
  } catch {
    return "(unparseable)"
  }
}

function redisTarget(url: string | undefined): string {
  if (!url) return "(unset)"
  try {
    const parsed = new URL(url)
    const db = parsed.pathname.replace(/^\//, "") || "0"
    // Host and db only — credentials are never printed.
    return `${parsed.hostname}:${parsed.port || "6379"} db ${db}`
  } catch {
    return "(unparseable)"
  }
}

function row(label: string, value: string, safe: boolean | null) {
  const mark = safe === null ? " " : safe ? "✓" : "✗"
  console.log(`  ${mark} ${label.padEnd(26)} ${value}`)
}

async function main() {
  const { namespace: loadedNamespace, overlayLoaded } = loadArciinEnv(repoRoot)
  const namespace = resolveEnvNamespace()

  const apiPort = Number(process.env.API_PORT || 4000)
  const webPort = Number(process.env.PORT || 3000)
  const dataDir = path.resolve(process.env.ARCIIN_DATA_DIR ?? "")
  const nextDistDir = process.env.NEXT_DIST_DIR || ".next"
  const queuePrefix = resolveQueuePrefix(namespace, process.env.ARCIIN_QUEUE_PREFIX)
  const socketChannel = resolveSocketChannel(
    namespace,
    SOCKET_EVENT_CHANNEL,
    process.env.ARCIIN_SOCKET_CHANNEL_PREFIX,
  )

  console.log("\nArciin environment doctor")
  console.log("─".repeat(64))
  console.log(`  namespace: ${namespace}${overlayLoaded ? "  (.env.development applied)" : ""}`)
  if (!overlayLoaded && !isProductionNamespace(namespace)) {
    console.log("  warning: .env.development was not found — development is running on .env alone.")
  }
  console.log("")

  const prod = isProductionNamespace(namespace)
  row("web port", String(webPort), prod ? null : webPort !== PRODUCTION_RESOURCES.webPort)
  row("api port", String(apiPort), prod ? null : apiPort !== PRODUCTION_RESOURCES.apiPort)
  row(
    "database",
    databaseName(process.env.DATABASE_URL),
    prod ? null : databaseName(process.env.DATABASE_URL) !== PRODUCTION_RESOURCES.databaseName,
  )
  row("redis", redisTarget(process.env.REDIS_URL), prod ? null : !redisTarget(process.env.REDIS_URL).endsWith("db 0"))
  row("storage root", dataDir || "(unset)", prod ? null : dataDir !== PRODUCTION_RESOURCES.dataDir)
  row("queue prefix", queuePrefix, prod ? null : queuePrefix !== PRODUCTION_RESOURCES.queuePrefix)
  row("socket channel", socketChannel, prod ? null : socketChannel !== SOCKET_EVENT_CHANNEL)
  row("next output dir", nextDistDir, prod ? null : nextDistDir !== PRODUCTION_RESOURCES.nextDistDir)

  if (dataDir) {
    try {
      await access(dataDir)
      console.log(`\n  storage root exists: yes`)
    } catch {
      console.log(`\n  storage root exists: no (it will be created on first upload)`)
    }
  }

  const problems = checkEnvironmentIsolation({
    namespace,
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    dataDir,
    apiPort,
    webPort,
    nextDistDir,
    queuePrefix,
  })

  console.log("")
  if (prod) {
    console.log("Namespace is production — isolation checks do not apply.")
    return
  }

  if (problems.length === 0) {
    console.log("Development is safely isolated from production. ✓")
    return
  }

  console.log(`Development is NOT isolated (${problems.length} problem${problems.length === 1 ? "" : "s"}):`)
  for (const problem of problems) console.log(`  • ${problem}`)
  console.log("\nFix .env.development before starting the development stack.")
  process.exitCode = 1

  void loadedNamespace
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
