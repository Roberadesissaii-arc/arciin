import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

const root = path.join(import.meta.dirname, "..")
const script = path.join(root, "scripts/worker-healthcheck.mjs")

function runHealth(env: NodeJS.ProcessEnv) {
  try {
    execFileSync("node", [script], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: "pipe",
    })
    return 0
  } catch (error) {
    const err = error as { status?: number }
    return err.status ?? 1
  }
}

describe("worker healthcheck (ARC-013)", () => {
  const prevUrl = process.env.REDIS_URL

  afterEach(() => {
    if (prevUrl) process.env.REDIS_URL = prevUrl
    else delete process.env.REDIS_URL
  })

  it("exits 2 when REDIS_URL is missing", () => {
    expect(runHealth({ REDIS_URL: "" })).toBe(2)
  })

  it("production compose uses the probe and does not embed credentials", () => {
    const compose = readFileSync(path.join(root, "docker-compose.production.yml"), "utf8")
    expect(compose).toMatch(/scripts\/worker-healthcheck\.mjs/)
    const probe = readFileSync(script, "utf8")
    expect(probe).not.toMatch(/password\s*[:=]/i)
    expect(probe).toMatch(/process\.exit\(0\)/)
    expect(probe).toMatch(/process\.exit\(1\)/)
  })
})
