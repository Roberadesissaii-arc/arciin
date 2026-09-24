import { describe, expect, it } from "vitest"

import { WORKER_HEARTBEAT_KEY, resolveNamespacedKey } from "@arciin/config"

/**
 * FIX-012 — one key, written and read by the same name.
 *
 * The worker wrote its heartbeat through `resolveNamespacedKey`, and the
 * health and logs routes read the bare constant. In production the namespace
 * resolves to the bare key, so the two happened to agree and the bug was
 * invisible; in every other namespace — dev, e2e, and any Docker deployment
 * that sets one — the reader looked for a key nobody writes and reported the
 * worker as `unknown` forever, while it sat there consuming jobs.
 *
 * These pin the property that made it invisible: the namespaced form differs
 * from the bare one everywhere except production, so a reader that skips the
 * helper is wrong in exactly the environments nobody watches.
 */
describe("the worker heartbeat key", () => {
  it("is the bare constant in production, which is why the bug hid", () => {
    expect(resolveNamespacedKey("production", WORKER_HEARTBEAT_KEY)).toBe(WORKER_HEARTBEAT_KEY)
  })

  it("differs from the bare constant in every other namespace", () => {
    for (const ns of ["dev", "e2e", "test", "staging", "docker"]) {
      const key = resolveNamespacedKey(ns, WORKER_HEARTBEAT_KEY)
      expect(key, `${ns} must be namespaced`).not.toBe(WORKER_HEARTBEAT_KEY)
      expect(key).toContain(WORKER_HEARTBEAT_KEY)
      expect(key.startsWith(ns)).toBe(true)
    }
  })

  it("gives two namespaces two different keys", () => {
    expect(resolveNamespacedKey("dev", WORKER_HEARTBEAT_KEY)).not.toBe(
      resolveNamespacedKey("e2e", WORKER_HEARTBEAT_KEY),
    )
  })

  it("is stable — the same namespace always resolves the same way", () => {
    expect(resolveNamespacedKey("dev", WORKER_HEARTBEAT_KEY)).toBe(
      resolveNamespacedKey("dev", WORKER_HEARTBEAT_KEY),
    )
  })
})

describe("the readers use the helper, not the bare constant", () => {
  /**
   * Source-level, because the failure was a *reader* that skipped the helper.
   * A behavioural test would need a live Redis per namespace to catch it; this
   * catches it the moment someone reintroduces the bare read.
   */
  const files = [
    "apps/api/src/routes/health.routes.ts",
    "apps/api/src/modules/logs/routes.ts",
  ]

  it("no route reads the un-namespaced heartbeat key", async () => {
    const { readFileSync } = await import("node:fs")
    const path = await import("node:path")
    const root = path.resolve(__dirname, "..")

    for (const rel of files) {
      const src = readFileSync(path.join(root, rel), "utf8")
      expect(src, `${rel} must not read the bare key`).not.toMatch(
        /redis\.get\(\s*WORKER_HEARTBEAT_KEY\s*\)/,
      )
      expect(src, `${rel} must read the namespaced key`).toMatch(
        /redis\.get\(\s*apiConfig\.workerHeartbeatKey\s*\)/,
      )
    }
  })
})
