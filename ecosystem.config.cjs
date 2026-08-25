/**
 * PM2 Ecosystem Config — Arciin (production)
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs     — start web + api + worker
 *   pm2 restart arciin-web             — restart web only
 *   pm2 stop arciin-web arciin-api arciin-worker
 *   pm2 logs arciin-web                — live logs
 *   pm2 monit                          — CPU / memory
 *
 * Ports and secrets are read from .env (set by install.sh).
 */

const fs = require("node:fs")
const path = require("node:path")

const ROOT = __dirname
const LOG_DIR = path.join(ROOT, "logs")

function parseEnvFile(filePath) {
  const env = { NODE_ENV: "production" }
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

// Read PORT from .env so PM2 matches install.sh
let port = 3000
try {
  const envPath = path.join(ROOT, ".env")
  const raw = fs.readFileSync(envPath, "utf8")
  const portMatch = raw.match(/^PORT=(\d+)/m)
  if (portMatch) port = parseInt(portMatch[1], 10)
  else {
    const urlMatch = raw.match(/^ARCIIN_PUBLIC_URL=.+:(\d+)/m)
    if (urlMatch) port = parseInt(urlMatch[1], 10)
  }
} catch {
  // default 3000
}

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true })
}

const dotenv = parseEnvFile(path.join(ROOT, ".env"))
const bindHost = dotenv.ARCIIN_BIND_HOST || "0.0.0.0"
const apiPort = String(dotenv.API_PORT || "4000")
const runWeb = path.join(ROOT, "scripts/run-web-prod.sh")
const runApi = path.join(ROOT, "scripts/run-api-prod.sh")
const runWorker = path.join(ROOT, "scripts/run-worker-prod.sh")

const sharedEnv = {
  ...dotenv,
  NODE_ENV: "production",
  // Pins PM2 to the production namespace so .env.development is never layered
  // in and the isolation guards treat these as the production instance.
  ARCIIN_ENV_NAMESPACE: "production",
  PORT: String(port),
  HOSTNAME: bindHost,
  API_PORT: apiPort,
}

const logDateFormat = "YYYY-MM-DD HH:mm:ss"

function appLogFiles(name) {
  return {
    error_file: path.join(LOG_DIR, `${name}-err.log`),
    out_file: path.join(LOG_DIR, `${name}-out.log`),
    log_date_format: logDateFormat,
  }
}

module.exports = {
  apps: [
    {
      name: "arciin-web",
      cwd: ROOT,
      script: runWeb,
      interpreter: "bash",
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_memory_restart: "1G",
      max_restarts: 20,
      min_uptime: "5s",
      env: sharedEnv,
      ...appLogFiles("arciin-web"),
    },
    {
      name: "arciin-api",
      cwd: ROOT,
      script: runApi,
      interpreter: "bash",
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_memory_restart: "768M",
      max_restarts: 20,
      min_uptime: "5s",
      env: sharedEnv,
      ...appLogFiles("arciin-api"),
    },
    {
      name: "arciin-worker",
      cwd: ROOT,
      script: runWorker,
      interpreter: "bash",
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_memory_restart: "768M",
      max_restarts: 20,
      min_uptime: "5s",
      env: sharedEnv,
      ...appLogFiles("arciin-worker"),
    },
    {
      /**
       * The public ingress for the licensing authority.
       *
       * A named Cloudflare tunnel, so the hostname survives restarts — a quick
       * tunnel gets a new random name every time it starts, which is fine for
       * looking at your own instance and useless for a licensing authority that
       * customers' installations and the checkout both hard-depend on.
       *
       * Its origin is the Caddy perimeter on 127.0.0.1:4443, never the
       * authority on 4100. The authority stays loopback-only and is not
       * reachable except through the perimeter's allowlist.
       *
       * Under PM2 rather than its own systemd unit because pm2-arce.service is
       * already enabled and owns reboot persistence for everything else here;
       * a second supervisor for one process would be a second thing to
       * remember.
       */
      name: "arciin-license-tunnel",
      cwd: ROOT,
      script: "cloudflared",
      args: ["--no-autoupdate", "--config", "/home/arce/.cloudflared/config.yml", "tunnel", "run"],
      interpreter: "none",
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      ...appLogFiles("arciin-license-tunnel"),
    },
  ],
}
