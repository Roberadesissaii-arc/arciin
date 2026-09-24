import { execSync } from "node:child_process"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = path.join(import.meta.dirname, "..")

describe("production backend bundles (ARC-004)", () => {
  it("emits non-empty API and worker artifacts — into a temp dir, never the live dist", () => {
    // PM2 runs apps/*/dist straight out of this checkout on the server; a test
    // must never overwrite what production executes.
    const out = mkdtempSync(path.join(tmpdir(), "arciin-backend-build-"))
    const liveApi = path.join(ROOT, "apps/api/dist/index.js")
    const before = (() => {
      try {
        return statSync(liveApi).mtimeMs
      } catch {
        return null
      }
    })()
    try {
      execSync("node scripts/build-backend.mjs", {
        cwd: ROOT,
        stdio: "pipe",
        env: { ...process.env, ARCIIN_BACKEND_OUT_DIR: out },
      })
      expect(statSync(path.join(out, "api/index.js")).size).toBeGreaterThan(10_000)
      expect(statSync(path.join(out, "worker/index.js")).size).toBeGreaterThan(10_000)
      const after = (() => {
        try {
          return statSync(liveApi).mtimeMs
        } catch {
          return null
        }
      })()
      expect(after, "the live apps/api/dist bundle was modified by a test").toBe(before)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})
