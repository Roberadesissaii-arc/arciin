const fs = require("node:fs")
const path = require("node:path")

const ROOT = __dirname

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

const dotenv = parseEnvFile(path.join(ROOT, ".env"))
const bindHost = dotenv.ARCIIN_BIND_HOST || "0.0.0.0"
const webPort =
  dotenv.PORT ||
  (() => {
    const m = String(dotenv.ARCIIN_PUBLIC_URL || "").match(/:(\d+)\/?$/)
    return m ? m[1] : "3000"
  })()

const sharedEnv = {
  ...dotenv,
  NODE_ENV: "production",
  PORT: webPort,
  HOSTNAME: bindHost,
}

module.exports = {
  apps: [
    {
      name: "arciin-web",
      cwd: ROOT,
      script: path.join(ROOT, "node_modules/next/dist/bin/next"),
      args: `start -H ${bindHost} -p ${webPort}`,
      env: sharedEnv,
      instances: 1,
      autorestart: true,
      max_restarts: 15,
      min_uptime: "5s",
    },
    {
      name: "arciin-api",
      cwd: ROOT,
      script: path.join(ROOT, "node_modules/.bin/tsx"),
      args: "apps/api/src/index.ts",
      env: sharedEnv,
      instances: 1,
      autorestart: true,
      max_restarts: 15,
      min_uptime: "5s",
    },
    {
      name: "arciin-worker",
      cwd: ROOT,
      script: path.join(ROOT, "node_modules/.bin/tsx"),
      args: "apps/worker/src/index.ts",
      env: sharedEnv,
      instances: 1,
      autorestart: true,
      max_restarts: 15,
      min_uptime: "5s",
    },
  ],
}
