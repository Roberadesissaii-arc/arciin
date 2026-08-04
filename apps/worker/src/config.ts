import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  SOCKET_EVENT_CHANNEL,
  WORKER_HEARTBEAT_KEY,
  assertEnvironmentIsolation,
  isProductionNamespace,
  loadArciinEnv,
  resolveEnvNamespace,
  resolveNamespacedKey,
  resolveQueuePrefix,
  resolveSocketChannel,
  workerEnvSchema,
} from "@arciin/config"

// Loads .env, then layers .env.development for non-production namespaces.
// ESM: __dirname does not exist, so derive the repo root from import.meta.url.
loadArciinEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."))

const parsed = workerEnvSchema.parse(process.env)

const envNamespace = resolveEnvNamespace()
const queuePrefix = resolveQueuePrefix(envNamespace, parsed.ARCIIN_QUEUE_PREFIX)

/**
 * The guard that matters most for the worker: without it a development worker
 * shares Redis db 0 and the `bull` prefix with production and silently
 * consumes real users' upload jobs — which is exactly what happened.
 */
assertEnvironmentIsolation({
  namespace: envNamespace,
  nodeEnv: parsed.NODE_ENV,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: parsed.REDIS_URL,
  dataDir: path.resolve(parsed.ARCIIN_DATA_DIR),
  queuePrefix,
})

export const workerConfig = {
  ...parsed,
  envNamespace,
  isProductionInstance: isProductionNamespace(envNamespace),
  queuePrefix,
  socketChannel: resolveSocketChannel(
    envNamespace,
    SOCKET_EVENT_CHANNEL,
    parsed.ARCIIN_SOCKET_CHANNEL_PREFIX,
  ),
  workerHeartbeatKey: resolveNamespacedKey(envNamespace, WORKER_HEARTBEAT_KEY),
}
