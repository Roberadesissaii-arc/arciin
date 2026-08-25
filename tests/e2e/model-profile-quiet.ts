import { execFileSync } from "node:child_process"
import path from "node:path"

/**
 * Keep a real model out of the suite's measurements.
 *
 * The browser suite runs against the developer's own dev instance, which on a
 * working machine has a local model configured and enabled — here an ollama
 * profile set as default. Auto-titling a conversation calls it on the server,
 * asynchronously, after the request that triggered it has already returned.
 *
 * That is correct behaviour and invisible to a user. It is ruinous to a test
 * suite: the model answers a trivial prompt in about five seconds on an idle
 * host, and the suite is not an idle host — it runs Chromium, ffmpeg for video
 * capture, and a production Next server. Requests began timing out, and work
 * started by one spec was still occupying the API while the next one ran. The
 * twenty-navigation entitlement test took 45 seconds alone, 1.2 minutes in a
 * green suite, and 5.3 minutes in a red one, failing on its own clock rather
 * than on anything it asserts.
 *
 * With no enabled profile, auto-title falls back to the user's first message —
 * instantly, and with no network call. Nothing in the non-opt-in suite asserts
 * on generated titles or on model output, so nothing is weakened by this; the
 * real-model specs are gated behind E2E_BOOK / E2E_ORGANIZE / an API key and
 * are skipped without them.
 *
 * Disabled, not deleted, and restored in teardown: this is the developer's own
 * instance, and a test run must give it back as it found it.
 */

const SCRIPT = path.resolve(__dirname, "../../scripts/e2e-model-profiles.mjs")

/** True when a real-model suite was explicitly requested. */
function realModelSuiteRequested(): boolean {
  return Boolean(
    process.env.E2E_BOOK || process.env.E2E_ORGANIZE || process.env.E2E_GEMINI_API_KEY,
  )
}

/** Returns the ids that were disabled, for teardown to restore. */
export function quietModelProfiles(): string[] {
  if (realModelSuiteRequested()) return []
  const out = execFileSync(process.execPath, [SCRIPT, "disable"], { encoding: "utf8" })
  const ids = out.trim().split("\n").filter(Boolean)
  if (ids.length > 0) {
    console.log(`[e2e] Disabled ${ids.length} model profile(s) for the run; restored afterwards`)
  }
  return ids
}

export function restoreModelProfiles(ids: string[]): void {
  if (ids.length === 0) return
  execFileSync(process.execPath, [SCRIPT, "restore", ...ids], { stdio: "inherit" })
}
