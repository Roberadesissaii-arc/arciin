import path from "node:path"

import { config as loadEnv } from "dotenv"
import { APP_VERSION, apiEnvSchema } from "@arciin/config"

loadEnv()

const parsed = apiEnvSchema.parse(process.env)

const defaultSetupToken =
  parsed.NODE_ENV !== "production" ? parsed.ARCIIN_SETUP_TOKEN || "dev-token" : parsed.ARCIIN_SETUP_TOKEN

if (!defaultSetupToken) {
  throw new Error("ARCIIN_SETUP_TOKEN is required in production.")
}

if (parsed.NODE_ENV === "production" && parsed.SESSION_SECRET.startsWith("change-this-in-production")) {
  throw new Error("SESSION_SECRET must be set to a strong random value in production. Generate one with: openssl rand -hex 32")
}

/**
 * Which upstream hops to trust for X-Forwarded-For. Default trusts only
 * loopback + private ranges (the real edge proxy is always Caddy/Next on a
 * private/loopback address), so a client on the public internet cannot forge
 * a trusted client IP. Overridable via ARCIIN_TRUST_PROXY (CSV of CIDRs, or a
 * hop count like "1").
 */
const DEFAULT_TRUSTED_PROXIES =
  "127.0.0.1/8, ::1/128, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, fc00::/7"

function resolveTrustProxy(): string | number {
  const raw = parsed.ARCIIN_TRUST_PROXY?.trim()
  if (!raw) return DEFAULT_TRUSTED_PROXIES
  const asNumber = Number(raw)
  return Number.isInteger(asNumber) && asNumber >= 0 && String(asNumber) === raw ? asNumber : raw
}

export const apiConfig = {
  ...parsed,
  setupToken: defaultSetupToken,
  appVersion: APP_VERSION,
  updateManifestUrl: parsed.ARCIIN_UPDATE_MANIFEST_URL,
  isProduction: parsed.NODE_ENV === "production",
  trustProxy: resolveTrustProxy(),
  maxUploadSizeBytes: parsed.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  dataDir: path.resolve(parsed.ARCIIN_DATA_DIR),
  storage: {
    objectsDir: path.resolve(parsed.ARCIIN_DATA_DIR, "objects"),
    librariesDir: path.resolve(parsed.ARCIIN_DATA_DIR, "libraries"),
    thumbnailsDir: path.resolve(parsed.ARCIIN_DATA_DIR, "thumbnails"),
    tempDir: path.resolve(parsed.ARCIIN_DATA_DIR, "temp"),
    logsDir: path.resolve(parsed.ARCIIN_DATA_DIR, "logs"),
  },
}
