import { execFileSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { evaluateParity, loadRepoFiles, parseComposeServices } from "../scripts/lib/install-parity.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")

describe("install parity verifier (ARC-012)", () => {
  it("parses production compose services regardless of key order", () => {
    const compose = readFileSync(path.join(ROOT, "docker-compose.production.yml"), "utf8")
    const services = parseComposeServices(compose)
    expect(Object.keys(services).sort()).toEqual(
      ["api", "caddy", "postgres", "redis", "web", "worker"].sort(),
    )
    expect(services.api?.raw).toMatch(/DATABASE_URL/)
    expect(services.worker?.raw).toMatch(/worker-healthcheck/)
  })

  it("passes against the current repository", () => {
    const errors = evaluateParity(loadRepoFiles(ROOT))
    expect(errors).toEqual([])
  })

  it("fails when production compose drops the worker", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arciin-parity-"))
    try {
      for (const rel of [
        "docker-compose.production.yml",
        "install.sh",
        "scripts/entrypoint-api.sh",
        "scripts/arciin-init.sh",
        "scripts/worker-healthcheck.mjs",
        "Dockerfile",
        ".env.example",
        ".env.docker.example",
        "docs/INSTALL-PARITY.md",
      ]) {
        const dest = path.join(dir, rel)
        mkdirSync(path.dirname(dest), { recursive: true })
        cpSync(path.join(ROOT, rel), dest)
      }
      const original = readFileSync(path.join(dir, "docker-compose.production.yml"), "utf8")
      writeFileSync(path.join(dir, "docker-compose.production.yml"), original.replace(/^  worker:/m, "  worker_removed:"))
      const errors = evaluateParity(loadRepoFiles(dir))
      expect(errors.some((error) => /worker/.test(error))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("fails when the API healthcheck disappears", () => {
    const files = loadRepoFiles(ROOT)
    files.productionCompose = files.productionCompose.replaceAll("/api/health", "/api/not-the-health-probe")
    const errors = evaluateParity(files)
    expect(errors.some((error) => /healthcheck does not probe/.test(error))).toBe(true)
  })

  it("the shell entrypoint exits 0 on this repo", () => {
    execFileSync("bash", ["scripts/verify-install-parity.sh"], { cwd: ROOT, stdio: "pipe" })
  })
})
