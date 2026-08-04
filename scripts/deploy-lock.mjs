#!/usr/bin/env node
/**
 * Deployment lock.
 *
 * `next start` serves live out of `apps/web/.next`, and `next build` rewrites
 * that directory in place. A second build started while the first is running —
 * or while the site is being served — leaves a half-written build directory,
 * which is a real, observed production outage: HTTP 500 with
 * "client reference manifest for route / does not exist" and a missing
 * BUILD_ID until the build completed.
 *
 * This lock makes that collision fail loudly instead of corrupting the build.
 *
 *   node scripts/deploy-lock.mjs acquire   # exits non-zero if held
 *   node scripts/deploy-lock.mjs release
 *   node scripts/deploy-lock.mjs status
 *
 * It guards deployments only. The API and worker never touch it.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { userInfo } from "node:os"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const LOCK_PATH = resolve(ROOT, ".arciin-deploy.lock")

/**
 * A deployment that outlives this is treated as abandoned. Long enough for a
 * slow build on a loaded box, short enough that a crashed deploy does not
 * block the next one indefinitely.
 */
const STALE_AFTER_MS = 30 * 60 * 1000

function readLock() {
  if (!existsSync(LOCK_PATH)) return null
  try {
    return JSON.parse(readFileSync(LOCK_PATH, "utf8"))
  } catch {
    // A corrupt lock file is treated as stale rather than blocking forever.
    return { corrupt: true, startedAt: 0 }
  }
}

/** A lock is only live if its process still exists. */
function holderAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function describe(lock) {
  const age = Math.round((Date.now() - (lock.startedAt ?? 0)) / 1000)
  return [
    `  pid:      ${lock.pid ?? "?"}${holderAlive(lock.pid) ? " (running)" : " (not running)"}`,
    `  user:     ${lock.user ?? "?"}`,
    `  command:  ${lock.command ?? "?"}`,
    `  repo:     ${lock.repo ?? "?"}`,
    `  started:  ${lock.startedAt ? new Date(lock.startedAt).toISOString() : "?"} (${age}s ago)`,
  ].join("\n")
}

function isStale(lock) {
  if (lock.corrupt) return true
  if (!holderAlive(lock.pid)) return true
  return Date.now() - (lock.startedAt ?? 0) > STALE_AFTER_MS
}

function acquire() {
  const existing = readLock()

  if (existing && !isStale(existing)) {
    console.error("Refusing to deploy: another deployment holds the lock.\n")
    console.error(describe(existing))
    console.error(
      "\nWait for it to finish, or if you are certain it is dead:\n" +
        "  node scripts/deploy-lock.mjs release --force",
    )
    process.exit(1)
  }

  if (existing) {
    console.warn("Reclaiming a stale deployment lock:")
    console.warn(describe(existing))
    console.warn("")
  }

  mkdirSync(dirname(LOCK_PATH), { recursive: true })
  writeFileSync(
    LOCK_PATH,
    `${JSON.stringify(
      {
        pid: process.ppid || process.pid,
        user: userInfo().username,
        command: process.env.ARCIIN_DEPLOY_COMMAND ?? "deploy",
        repo: ROOT,
        startedAt: Date.now(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  )
  console.log("Deployment lock acquired.")
}

function release({ force }) {
  const existing = readLock()
  if (!existing) {
    console.log("No deployment lock held.")
    return
  }

  const mine = (existing.pid === (process.ppid || process.pid)) || isStale(existing)
  if (!mine && !force) {
    console.error("Refusing to release a lock owned by a live deployment:\n")
    console.error(describe(existing))
    console.error("\nUse --force only if you are certain that process is gone.")
    process.exit(1)
  }

  unlinkSync(LOCK_PATH)
  console.log("Deployment lock released.")
}

function status() {
  const existing = readLock()
  if (!existing) {
    console.log("Deployment lock: free")
    return
  }
  const stale = isStale(existing)
  console.log(`Deployment lock: ${stale ? "STALE (reclaimable)" : "HELD"}`)
  console.log(describe(existing))
  // Held-and-live is a legitimate state, not an error — exit non-zero only so
  // scripts can branch on it.
  if (!stale) process.exitCode = 1
}

const [command, ...rest] = process.argv.slice(2)
const force = rest.includes("--force")

switch (command) {
  case "acquire":
    acquire()
    break
  case "release":
    release({ force })
    break
  case "status":
    status()
    break
  default:
    console.error("usage: deploy-lock.mjs <acquire|release|status> [--force]")
    process.exit(2)
}
