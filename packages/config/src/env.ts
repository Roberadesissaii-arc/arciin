import { z } from "zod"

/** Shared environment fields used by API, worker, and install scripts. */
export const coreEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ARCIIN_DATA_DIR: z.string().default("/srv/arciin-storage/arciin"),
})

export const apiEnvSchema = coreEnvSchema.extend({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ARCIIN_SETUP_TOKEN: z.string().optional(),
  ARCIIN_PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  ARCIIN_API_URL: z.string().url().default("http://localhost:4000"),
  SESSION_COOKIE_NAME: z.string().default("arciin_session"),
  SESSION_SECRET: z.string().min(32).default("change-this-in-production-must-be-32-chars-min"),
  /**
   * Dedicated key for encrypting vault/webhook/integration secrets at rest
   * (64 hex chars = 32 bytes). Optional: when unset OR blank, the key is derived
   * from SESSION_SECRET so existing ciphertext keeps decrypting. Set it on fresh
   * installs to decouple session signing from data encryption. An empty value
   * (e.g. a placeholder line in .env) is treated as unset, never a parse error.
   */
  ARCIIN_ENCRYPTION_KEY: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  ),
  /**
   * Proxy hops the API trusts for client-IP resolution. CSV of IPs/CIDRs, or a
   * hop count. Defaults to loopback + RFC-1918/ULA so a client cannot forge
   * X-Forwarded-For past the real edge proxy.
   */
  ARCIIN_TRUST_PROXY: z.string().optional(),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(20 * 1024),
  API_PORT: z.coerce.number().int().positive().default(4000),
  /**
   * Hosted license server (future license.arciin.com). When set, activate/refresh
   * call this service. Empty → local mock keys only (dev fallback).
   */
  ARCIIN_LICENSE_SERVER_URL: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().url().optional(),
  ),
  /**
   * HMAC secret shared with the license server for verifying signed tokens.
   * Must match LICENSE_SIGNING_SECRET on the license server.
   */
  ARCIIN_LICENSE_VERIFY_SECRET: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().min(16).optional(),
  ),
  /**
   * When "1"/"true", allow ARCIIN-DEV-* / arc_demo_* local mock activation even if
   * a license server URL is configured (useful offline / unit tests).
   * Default: true in development, false in production.
   */
  ARCIIN_LICENSE_DEV_FALLBACK: z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return undefined
    if (v === true || v === "1" || v === "true") return true
    if (v === false || v === "0" || v === "false") return false
    return undefined
  }, z.boolean().optional()),
})

export const workerEnvSchema = coreEnvSchema.extend({
  REDIS_URL: z.string().min(1),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(20 * 1024),
  /** Concurrent media jobs per worker process. Keep low — transcodes are heavy. */
  ARCIIN_WORKER_CONCURRENCY: z.coerce.number().int().positive().max(16).default(2),
})

export type CoreEnv = z.infer<typeof coreEnvSchema>
export type ApiEnv = z.infer<typeof apiEnvSchema>
export type WorkerEnv = z.infer<typeof workerEnvSchema>

/** Install role — server hosts DB/storage; clients talk to API only. */
export const ARCIIN_INSTALL_ROLES = ["server", "client"] as const
export type ArciinInstallRole = (typeof ARCIIN_INSTALL_ROLES)[number]
