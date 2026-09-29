import { readFileSync } from "node:fs"

import { parse } from "dotenv"

/**
 * Every variable this server reads (config.ts schema, index.ts, server.ts).
 *
 * The repo-root .env belongs to the self-hosted Arciin API and worker — it
 * holds DATABASE_URL, session and vault secrets this server never uses. It was
 * loaded wholesale, so all of them sat in this process's memory. Only these
 * keys are taken from it now.
 *
 * Keep in step with LICENSE_SERVER_ENV_KEYS in scripts/lib/vendor-env.cjs
 * (tests/vendor-env-least-privilege.test.ts fails if they drift).
 */
export const LICENSE_SERVER_ENV_KEYS = [
  "NODE_ENV",
  "LOG_LEVEL",
  "LICENSE_SERVER_HOST",
  "LICENSE_SERVER_PORT",
  "LICENSE_DATABASE_URL",
  "LICENSE_SIGNING_KEY",
  "LICENSE_SIGNING_KID",
  "LICENSE_SERVICE_TOKENS",
  "LICENSE_ADMIN_TOKENS",
  "LICENSE_LEGACY_HMAC_SECRET",
  "LICENSE_RATE_LIMIT_PER_MINUTE",
] as const

/**
 * Copy only this server's keys from a parsed env file into `target`.
 *
 * Like dotenv, a value that is already set wins — a real environment (PM2,
 * systemd, the shell) still overrides the file. Returns the keys it applied.
 */
export function applyLicenseServerEnv(
  parsed: Record<string, string>,
  target: NodeJS.ProcessEnv = process.env,
): string[] {
  const applied: string[] = []
  for (const key of LICENSE_SERVER_ENV_KEYS) {
    if (parsed[key] === undefined || target[key] !== undefined) continue
    target[key] = parsed[key]
    applied.push(key)
  }
  return applied
}

/** Read a .env file and apply only this server's keys. A missing file is not an error. */
export function loadLicenseServerEnvFile(filePath: string, target: NodeJS.ProcessEnv = process.env): string[] {
  let text: string
  try {
    text = readFileSync(filePath, "utf8")
  } catch {
    return []
  }
  return applyLicenseServerEnv(parse(text), target)
}
