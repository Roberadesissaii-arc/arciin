import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

import { createTemporaryGeminiProfile, removeTemporaryGeminiProfile } from "./gemini-fixture"

/**
 * Everything the suite needs before a browser opens, and nothing left behind.
 *
 * The seeder runs as a subprocess rather than an import: Playwright transpiles
 * this file to CommonJS, and the seed script is ESM using `import.meta`, so a
 * direct import fails at load. A subprocess also keeps the seeder usable on its
 * own (`node scripts/e2e-seed.mjs`) when debugging a login failure.
 *
 * Setup is ordered so that a failure part-way through still tears down whatever
 * already exists — a spawned worker or a temporary credential must not outlive
 * a crash during setup.
 */

/** Where the spawned worker's pid is recorded, so a later run can find it. */
const WORKER_PID_FILE = path.resolve(__dirname, "../../test-results/.e2e-media-worker.pid")

/** The entrypoint our worker runs. Used to confirm identity, never to match on. */
const WORKER_ENTRYPOINT = "apps/worker/src/index.ts"

export default function globalSetup() {
  const script = path.resolve(__dirname, "../../scripts/e2e-seed.mjs")
  // Inherit stdio so a seeding failure is visible rather than swallowed.
  execFileSync(process.execPath, [script], { stdio: "inherit" })

  reapOrphanedWorker()

  let worker: ChildProcess | null = null
  let geminiProfileCreated = false

  try {
    worker = startMediaWorker()
    geminiProfileCreated = createTemporaryGeminiProfile()
    if (!geminiProfileCreated) {
      console.log(
        "[e2e] Real Gemini E2E skipped: E2E_GEMINI_API_KEY not configured",
      )
    }
  } catch (error) {
    // Setup failed after something was already created. Undo it here, because
    // Playwright never runs teardown for a globalSetup that threw.
    teardown(worker, geminiProfileCreated)
    throw error
  }

  // Playwright runs a returned function as global teardown.
  return () => teardown(worker, geminiProfileCreated)
}

function teardown(worker: ChildProcess | null, geminiProfileCreated: boolean) {
  // Both, whatever either one does: a failure stopping the worker must not
  // strand a paid credential in the dev database.
  try {
    stopMediaWorker(worker)
  } finally {
    if (geminiProfileCreated) removeTemporaryGeminiProfile()
  }
}

/**
 * Clear a worker a previous run could not stop.
 *
 * `detached: true` is what lets teardown take the whole group, but it also means
 * the worker survives Playwright being killed rather than exiting — teardown
 * never runs, and the group is left parented to init. A run was found to have
 * leaked exactly that way.
 *
 * Three things must all hold before anything is signalled, because a pid is
 * reused eventually and the production worker runs the very same entrypoint:
 *
 *   1. the pid was recorded by *this* harness,
 *   2. the process really is that worker, and
 *   3. it is orphaned — `ppid` 1.
 *
 * The production worker is supervised by PM2, so its parent is never 1. That is
 * the check that makes this safe rather than merely careful.
 */
function reapOrphanedWorker() {
  if (!existsSync(WORKER_PID_FILE)) return
  const recorded = Number(readFileSync(WORKER_PID_FILE, "utf8").trim())
  rmSync(WORKER_PID_FILE, { force: true })
  if (!Number.isInteger(recorded) || recorded <= 1) return

  try {
    const cmdline = readFileSync(`/proc/${recorded}/cmdline`, "utf8")
    if (!cmdline.includes(WORKER_ENTRYPOINT)) return

    const status = readFileSync(`/proc/${recorded}/status`, "utf8")
    const ppid = Number(/^PPid:\s*(\d+)$/m.exec(status)?.[1])
    if (ppid !== 1) return

    process.kill(-recorded, "SIGTERM")
    console.log(`[e2e] reaped an orphaned media worker from a previous run (pid ${recorded})`)
  } catch {
    // Gone already, or not a process we can inspect. Either way, nothing to do.
  }
}

/**
 * The media worker, which `webServer` cannot start.
 *
 * `webServer` entries are polled on a `url` or `port` before the suite begins,
 * and the worker is a queue consumer with no HTTP surface at all — there is
 * nothing to poll. So it is spawned here instead, rather than bolting an HTTP
 * server onto the worker purely to satisfy Playwright.
 *
 * Without it, anything queued during a test simply sits in Redis with no
 * consumer: the transcript suite hung on a job that was never going to be
 * picked up, and the symptom — a spinner that never resolves — looks exactly
 * like a broken feature rather than a missing process.
 */
function startMediaWorker(): ChildProcess | null {
  const repoRoot = path.resolve(__dirname, "../..")
  try {
    const child = spawn(
      "npx",
      ["tsx", "--tsconfig", "apps/worker/tsconfig.json", "apps/worker/src/index.ts"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          // The dev namespace, so it consumes the same queue prefix the dev API
          // publishes to and never touches production's.
          ARCIIN_ENV_NAMESPACE: "dev",
          API_PORT: process.env.E2E_API_PORT ?? "4300",
          PORT: process.env.E2E_WEB_PORT ?? "3300",
        },
        // Own process group, so teardown can take its children with it.
        detached: true,
        stdio: "ignore",
      },
    )
    child.unref()
    // Published so a spec can assert the suite owns a worker, and so nothing
    // has to go looking for one by command text.
    if (child.pid) {
      process.env.E2E_WORKER_PID = String(child.pid)
      // Recorded so a later run can clean up after a Playwright that was killed
      // rather than allowed to tear down.
      mkdirSync(path.dirname(WORKER_PID_FILE), { recursive: true })
      writeFileSync(WORKER_PID_FILE, String(child.pid))
    }
    return child
  } catch (error) {
    // A missing worker is not worth failing the whole suite: most specs never
    // queue anything. The ones that do fail fast with their own message.
    console.warn(
      `[e2e] could not start the media worker: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return null
  }
}

/**
 * Stop only the worker this run started.
 *
 * By pid, never by command text. A pattern like `pkill -f apps/worker/src/index.ts`
 * reads as precise and is not: it matches the production PM2 worker running the
 * very same entrypoint, and killing that is a production incident caused by a
 * test tidying up after itself.
 *
 * The negative pid signals the process group created by `detached: true`, so
 * `npx` and the `tsx` child both go — and nothing outside that group can be
 * reached, because a process group contains only what this spawn created.
 */
function stopMediaWorker(worker: ChildProcess | null) {
  if (!worker?.pid) return
  try {
    process.kill(-worker.pid, "SIGTERM")
  } catch {
    /* already gone */
  } finally {
    delete process.env.E2E_WORKER_PID
    rmSync(WORKER_PID_FILE, { force: true })
  }
}
