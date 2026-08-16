import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import path from "node:path"

/**
 * Seed the dev owner account and start the media worker before the suite runs.
 *
 * The seeder runs as a subprocess rather than an import: Playwright transpiles
 * this file to CommonJS, and the seed script is ESM using `import.meta`, so a
 * direct import fails at load. A subprocess also keeps the seeder usable on its
 * own (`node scripts/e2e-seed.mjs`) when debugging a login failure.
 */
export default function globalSetup() {
  const script = path.resolve(__dirname, "../../scripts/e2e-seed.mjs")
  // Inherit stdio so a seeding failure is visible rather than swallowed.
  execFileSync(process.execPath, [script], { stdio: "inherit" })

  const worker = startMediaWorker()
  // Playwright runs a returned function as global teardown.
  return () => stopMediaWorker(worker)
}

/**
 * The media worker, which `webServer` cannot start.
 *
 * `webServer` entries are polled on a `url` or `port` before the suite begins,
 * and the worker is a queue consumer with no HTTP surface at all — there is
 * nothing to poll. So it is spawned here instead.
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
    return child
  } catch (error) {
    // A missing worker is not worth failing the whole suite: most specs never
    // queue anything. The ones that do will time out with their own message.
    console.warn(
      `[e2e] could not start the media worker: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return null
  }
}

function stopMediaWorker(worker: ChildProcess | null) {
  if (!worker?.pid) return
  try {
    // Negative pid signals the group, so `npx` and the `tsx` child both go.
    process.kill(-worker.pid, "SIGTERM")
  } catch {
    /* already gone */
  }
}
