/**
 * PM2 Ecosystem Config — Arciin vendor services (NOT for self-hosted installs)
 *
 * The licence server and the customer account portal are run by us, not by
 * people who self-host Arciin. They are deliberately kept out of
 * ecosystem.config.cjs so `pm2 start ecosystem.config.cjs` on a customer's
 * server starts only web + api + worker.
 *
 * Usage:
 *   pm2 start ecosystem.vendor.config.cjs
 *   pm2 restart arciin-license-server
 *   pm2 logs arciin-account
 *
 * The account portal serves a production build — run `pnpm --filter
 * @arciin/account build` before starting or restarting it.
 */

const fs = require("node:fs")
const path = require("node:path")

const ROOT = __dirname
const LOG_DIR = path.join(ROOT, "logs")

function parseEnvFile(filePath) {
  const env = {}
  if (!fs.existsSync(filePath)) return env
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

const dotenv = parseEnvFile(path.join(ROOT, ".env"))

const sharedEnv = {
  ...dotenv,
  NODE_ENV: "production",
  ARCIIN_ENV_NAMESPACE: "production",
}

function appLogFiles(name) {
  return {
    error_file: path.join(LOG_DIR, `${name}-err.log`),
    out_file: path.join(LOG_DIR, `${name}-out.log`),
    log_date_format: "YYYY-MM-DD HH:mm:ss",
  }
}

module.exports = {
  apps: [
    {
      name: "arciin-license-server",
      cwd: ROOT,
      script: "pnpm",
      args: "--filter @arciin/license-server start",
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_memory_restart: "512M",
      max_restarts: 20,
      min_uptime: "5s",
      env: sharedEnv,
      ...appLogFiles("arciin-license-server"),
    },
    {
      name: "arciin-account",
      cwd: path.join(ROOT, "apps/account"),
      script: "pnpm",
      args: "start",
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_memory_restart: "512M",
      max_restarts: 20,
      min_uptime: "5s",
      env: sharedEnv,
      ...appLogFiles("arciin-account"),
    },
  ],
}
