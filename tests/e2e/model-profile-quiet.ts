import { execFileSync } from "node:child_process"
import path from "node:path"

/**
 * Keep a real model out of the suite's measurements.
 *
 * The browser suite runs against the developer's own dev instance, which on a
 * working machine has a local model configured. Auto-titling a conversation
 * calls it on the server, after the request that triggered it has already
 * returned. That is correct, and invisible to a user. It is ruinous here: the
 * model answers a trivial prompt in about five seconds on an idle host, and
 * this host runs Chromium, ffmpeg for video capture and a production Next
 * server. Work started by one spec was still occupying the API while the next
 * one ran — the twenty-navigation entitlement test took 45 seconds alone, 1.2
 * minutes in a green suite and 5.3 minutes in a red one, failing on its own
 * clock rather than on anything it asserts.
 *
 * The endpoint moves; the profile stays enabled. Turning profiles off was the
 * first attempt and it broke three chat specs outright — the composer is
 * disabled when no model is configured, so tests that stub the chat stream and
 * never need a model failed on a composer that would not accept typing.
 *
 * Nothing is weakened: no spec that runs by default asserts on generated titles
 * or on model output, and the real-model suites are gated behind E2E_BOOK,
 * E2E_ORGANIZE or an API key — when any of those is set, this does nothing.
 */

const SCRIPT = path.resolve(__dirname, "../../scripts/e2e-model-profiles.mjs")

/** True when a real-model suite was explicitly requested. */
function realModelSuiteRequested(): boolean {
  return Boolean(
    process.env.E2E_BOOK || process.env.E2E_ORGANIZE || process.env.E2E_GEMINI_API_KEY,
  )
}

export function quietModelProfiles(): boolean {
  if (realModelSuiteRequested()) return false
  execFileSync(process.execPath, [SCRIPT, "quiet"], { stdio: "inherit" })
  return true
}

export function restoreModelProfiles(quieted: boolean): void {
  if (!quieted) return
  execFileSync(process.execPath, [SCRIPT, "restore"], { stdio: "inherit" })
}
