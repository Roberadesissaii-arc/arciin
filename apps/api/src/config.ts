import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  APP_VERSION,
  SOCKET_EVENT_CHANNEL,
  WORKER_HEARTBEAT_KEY,
  apiEnvSchema,
  assertEnvironmentIsolation,
  isProductionNamespace,
  loadArciinEnv,
  resolveEnvNamespace,
  resolveNamespacedKey,
  defaultPublicKeyRegistry,
  resolveQueuePrefix,
  resolveSocketChannel,
} from "@arciin/config"

import {
  isWeakProductionSecret,
  resolveLegacyLicenseSecretFrom,
} from "@/services/security/production-secrets"

// Loads .env, then layers .env.development for non-production namespaces.
// ESM: __dirname does not exist, so derive the repo root from import.meta.url.
loadArciinEnv(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."))

const parsed = apiEnvSchema.parse(process.env)

const envNamespace = resolveEnvNamespace()
const queuePrefix = resolveQueuePrefix(envNamespace, parsed.ARCIIN_QUEUE_PREFIX)
const resolvedDataDir = path.resolve(parsed.ARCIIN_DATA_DIR)

/**
 * Refuse to start a development API that would reach into production state —
 * the production database, Redis db 0, the production storage root, the
 * production BullMQ prefix, or port 4000. Production is never blocked.
 */
assertEnvironmentIsolation({
  namespace: envNamespace,
  nodeEnv: parsed.NODE_ENV,
  databaseUrl: parsed.DATABASE_URL,
  redisUrl: parsed.REDIS_URL,
  dataDir: resolvedDataDir,
  apiPort: parsed.API_PORT,
  queuePrefix,
})


function resolveSetupToken(): string {
  if (parsed.NODE_ENV !== "production") {
    return parsed.ARCIIN_SETUP_TOKEN?.trim() || "dev-token"
  }
  const token = parsed.ARCIIN_SETUP_TOKEN?.trim() ?? ""
  if (!token || isWeakProductionSecret(token, { minLen: 16 })) {
    throw new Error(
      "ARCIIN_SETUP_TOKEN must be a strong random value in production (not empty, not dev-token/change-me). Generate one with: openssl rand -hex 24",
    )
  }
  return token
}

const setupToken = resolveSetupToken()

if (parsed.NODE_ENV === "production" && isWeakProductionSecret(parsed.SESSION_SECRET, { minLen: 32 })) {
  throw new Error(
    "SESSION_SECRET must be a strong random value in production (min 32 chars). Generate one with: openssl rand -hex 32",
  )
}

/**
 * Entitlement tokens are verified with a public key, so there is no secret to
 * resolve and nothing to fail the boot over. The legacy HMAC secret is read
 * only if an operator still has one set from before the migration.
 */
const legacyLicenseSecretValue = resolveLegacyLicenseSecretFrom({
  configured: parsed.ARCIIN_LICENSE_VERIFY_SECRET,
  fallback: process.env.LICENSE_SIGNING_SECRET,
  isProduction: parsed.NODE_ENV === "production",
})

const licensePublicKeyRegistry = defaultPublicKeyRegistry(parsed.ARCIIN_LICENSE_PUBLIC_KEYS)

/**
 * Which upstream hops to trust for X-Forwarded-For. Default trusts only
 * loopback + private ranges (the real edge proxy is always Caddy/Next on a
 * private/loopback address), so a client on the public internet cannot forge
 * a trusted client IP. Overridable via ARCIIN_TRUST_PROXY (CSV of CIDRs).
 *
 * A bare hop count is no longer accepted. Fastify 5.12 made numeric trustProxy
 * trust nothing at all — hop counting cannot validate the immediate peer, so a
 * direct client could otherwise spoof X-Forwarded-For by sending enough hops.
 * Honouring the old spelling silently would leave request.ip pointing at the
 * proxy instead of the client, quietly corrupting rate limits and audit logs,
 * so we say so and fall back to the safe default rather than guessing.
 */
const DEFAULT_TRUSTED_PROXIES =
  "127.0.0.1/8, ::1/128, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, fc00::/7"

function resolveTrustProxy(): string {
  const raw = parsed.ARCIIN_TRUST_PROXY?.trim()
  if (!raw) return DEFAULT_TRUSTED_PROXIES
  if (/^\d+$/.test(raw)) {
    throw new Error(
      "ARCIIN_TRUST_PROXY no longer accepts a hop count. Set it to a comma-separated " +
        "list of CIDRs for your proxies (for example \"127.0.0.1/8, 10.0.0.0/8\"), or " +
        "unset it to trust only loopback and private ranges.",
    )
  }
  return raw
}

export const apiConfig = {
  ...parsed,
  setupToken,
  /** Null on any install that did not predate the Ed25519 migration. */
  legacyLicenseSecret: legacyLicenseSecretValue,
  licensePublicKeyRegistry,
  appVersion: APP_VERSION,
  updateManifestUrl: parsed.ARCIIN_UPDATE_MANIFEST_URL,
  isProduction: parsed.NODE_ENV === "production",
  envNamespace,
  isProductionInstance: isProductionNamespace(envNamespace),
  queuePrefix,
  socketChannel: resolveSocketChannel(
    envNamespace,
    SOCKET_EVENT_CHANNEL,
    parsed.ARCIIN_SOCKET_CHANNEL_PREFIX,
  ),
  workerHeartbeatKey: resolveNamespacedKey(envNamespace, WORKER_HEARTBEAT_KEY),
  trustProxy: resolveTrustProxy(),
  maxUploadSizeBytes: parsed.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  dataDir: resolvedDataDir,
  storage: {
    objectsDir: path.resolve(parsed.ARCIIN_DATA_DIR, "objects"),
    librariesDir: path.resolve(parsed.ARCIIN_DATA_DIR, "libraries"),
    thumbnailsDir: path.resolve(parsed.ARCIIN_DATA_DIR, "thumbnails"),
    tempDir: path.resolve(parsed.ARCIIN_DATA_DIR, "temp"),
    logsDir: path.resolve(parsed.ARCIIN_DATA_DIR, "logs"),
  },
}
