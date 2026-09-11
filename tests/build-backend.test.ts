import { execSync } from "node:child_process"
import { statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

describe("production backend bundles (ARC-004)", () => {
  it("emits non-empty API and worker artifacts", () => {
    execSync("node scripts/build-backend.mjs", {
      cwd: path.join(import.meta.dirname, ".."),
      stdio: "pipe",
    })
    const api = path.join(import.meta.dirname, "../apps/api/dist/index.js")
    const worker = path.join(import.meta.dirname, "../apps/worker/dist/index.js")
    expect(statSync(api).size).toBeGreaterThan(10_000)
    expect(statSync(worker).size).toBeGreaterThan(10_000)
  })
})
