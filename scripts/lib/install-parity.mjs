#!/usr/bin/env node
/**
 * Semantic native ↔ production-Docker contract checks (ARC-012).
 *
 * Reads docker-compose.production.yml and native install scripts. Not a
 * formatter-sensitive grep of docker-compose.yml (development).
 */

import fs from "node:fs"
import path from "node:path"

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(import.meta.dirname, "../..")

const REQUIRED_SERVICES = ["caddy", "web", "api", "worker", "postgres", "redis"]
const REQUIRED_ENV_EXAMPLE = [
  "ARCIIN_SETUP_TOKEN",
  "SESSION_SECRET",
  "MAX_UPLOAD_SIZE_MB",
  "UPLOAD_RATE_LIMIT_PER_MINUTE",
  "LOG_MAX_FILE_BYTES",
]

/** Top-level compose services and a coarse map of their keys. */
export function parseComposeServices(source) {
  const services = {}
  let current = null
  let inServices = false
  for (const line of source.split("\n")) {
    if (/^services:\s*$/.test(line)) {
      inServices = true
      continue
    }
    if (inServices && /^[a-zA-Z]/.test(line) && !line.startsWith(" ")) {
      break
    }
    const service = inServices ? /^  ([a-zA-Z0-9_-]+):\s*$/.exec(line) : null
    if (service) {
      current = service[1]
      services[current] = { name: current, raw: "" }
      continue
    }
    if (current && /^(    |\t)/.test(line)) {
      services[current].raw += `${line}\n`
    }
  }
  return services
}

function hasHealthcheck(block) {
  return /healthcheck:/.test(block.raw)
}

function hasVolumeBind(block, needle) {
  return block.raw.includes(needle)
}

function hasEnv(block, name) {
  return block.raw.includes(name)
}

export function evaluateParity(files) {
  const errors = []
  const compose = parseComposeServices(files.productionCompose)

  for (const name of REQUIRED_SERVICES) {
    if (!compose[name]) errors.push(`production compose missing service: ${name}`)
  }

  const api = compose.api
  const worker = compose.worker
  if (api) {
    if (!hasHealthcheck(api)) errors.push("api service missing healthcheck")
    if (!hasVolumeBind(api, "/data/arciin")) errors.push("api service missing /data/arciin storage mount")
    if (!hasEnv(api, "DATABASE_URL")) errors.push("api service missing DATABASE_URL")
    if (!hasEnv(api, "REDIS_URL")) errors.push("api service missing REDIS_URL")
    if (!hasEnv(api, "POSTGRES_PASSWORD")) errors.push("api DATABASE_URL does not require POSTGRES_PASSWORD")
    if (!/\/api\/health/.test(api.raw)) errors.push("api healthcheck does not probe /api/health")
  }
  if (worker) {
    if (!hasHealthcheck(worker)) errors.push("worker service missing healthcheck")
    if (!hasVolumeBind(worker, "/data/arciin")) errors.push("worker service missing /data/arciin storage mount")
    if (!/worker-healthcheck/.test(worker.raw)) errors.push("worker healthcheck does not use worker-healthcheck.mjs")
  }
  if (compose.postgres && !hasHealthcheck(compose.postgres)) {
    errors.push("postgres service missing healthcheck")
  }
  if (compose.redis && !hasHealthcheck(compose.redis)) {
    errors.push("redis service missing healthcheck")
  }

  if (!files.install.includes("arciin-init.sh")) {
    errors.push("native install.sh does not run arciin-init.sh")
  }
  if (!files.install.includes("pm2") && !files.install.includes("ecosystem.config")) {
    errors.push("native install.sh does not start the PM2 process set")
  }
  if (!files.entrypointApi.includes("arciin-init")) {
    errors.push("Docker API entrypoint does not run arciin-init")
  }
  if (!files.init.includes("prisma migrate deploy") && !files.init.includes("migrate deploy")) {
    errors.push("arciin-init.sh does not run prisma migrate deploy")
  }
  if (!files.workerHealth.includes("worker") && !fs.existsSync(path.join(root, "scripts/worker-healthcheck.mjs"))) {
    errors.push("worker healthcheck script missing")
  }
  if (!files.dockerfile.includes("AS web") || !files.dockerfile.includes("AS api") || !files.dockerfile.includes("AS worker")) {
    errors.push("Dockerfile missing web/api/worker targets")
  }

  for (const key of REQUIRED_ENV_EXAMPLE) {
    if (!new RegExp(`^${key}=`, "m").test(files.envExample)) {
      errors.push(`.env.example missing ${key}`)
    }
    if (!new RegExp(`^${key}=`, "m").test(files.envDockerExample)) {
      errors.push(`.env.docker.example missing ${key}`)
    }
  }

  if (!files.parityDoc.includes("Intentional differences")) {
    errors.push("docs/INSTALL-PARITY.md must document intentional differences")
  }

  return errors
}

export function loadRepoFiles(base = root) {
  return {
    productionCompose: readRel(base, "docker-compose.production.yml"),
    install: readRel(base, "install.sh"),
    entrypointApi: readRel(base, "scripts/entrypoint-api.sh"),
    init: readRel(base, "scripts/arciin-init.sh"),
    workerHealth: fs.existsSync(path.join(base, "scripts/worker-healthcheck.mjs"))
      ? readRel(base, "scripts/worker-healthcheck.mjs")
      : "",
    dockerfile: readRel(base, "Dockerfile"),
    envExample: readRel(base, ".env.example"),
    envDockerExample: readRel(base, ".env.docker.example"),
    parityDoc: readRel(base, "docs/INSTALL-PARITY.md"),
  }
}

function readRel(base, rel) {
  return fs.readFileSync(path.join(base, rel), "utf8")
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("install-parity.mjs")) {
  try {
    const errors = evaluateParity(loadRepoFiles(root))
    if (errors.length) {
      for (const error of errors) console.error(`  ✖  ${error}`)
      process.exit(1)
    }
    console.log("  production compose contract: ok")
    process.exit(0)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
