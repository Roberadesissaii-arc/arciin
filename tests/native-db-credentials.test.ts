import { execFileSync, execSync } from "node:child_process"
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "..")
const LIB = path.join(ROOT, "scripts/lib/db-credentials.sh")

function run(script: string, extraEnv: NodeJS.ProcessEnv = {}) {
  return execSync(`source "${LIB}"; ${script}`, {
    cwd: ROOT,
    encoding: "utf8",
    shell: "/bin/bash",
    env: { ...process.env, ...extraEnv },
  })
}

describe("native installer database credentials (ARC-009)", () => {
  it("generates different passwords for two fresh resolves", () => {
    const dir = path.join(tmpdir(), `arciin-dbcred-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      const a = path.join(dir, "a.env")
      const b = path.join(dir, "b.env")
      writeFileSync(a, "DATABASE_URL=postgresql://arciin:arciin@localhost:5432/arciin\n")
      writeFileSync(b, "DATABASE_URL=postgresql://arciin:arciin@localhost:5432/arciin\n")
      const first = run(`arciin_resolve_db_password "${a}" 1`).trim()
      const second = run(`arciin_resolve_db_password "${b}" 1`).trim()
      expect(first).toHaveLength(48)
      expect(second).toHaveLength(48)
      expect(first).not.toBe(second)
      expect(first).not.toBe("arciin")
      expect(second).not.toBe("arciin")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("preserves a configured credential on rerun", () => {
    const dir = path.join(tmpdir(), `arciin-dbcred-keep-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      const envFile = path.join(dir, ".env")
      writeFileSync(envFile, "DATABASE_URL=postgresql://arciin:already-configured-secret@localhost:5433/arciin\n")
      const first = run(`arciin_resolve_db_password "${envFile}" 0`).trim()
      const second = run(`arciin_resolve_db_password "${envFile}" 0`).trim()
      expect(first).toBe("already-configured-secret")
      expect(second).toBe("already-configured-secret")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("URL-encodes special characters without corrupting the URL", () => {
    const raw = "p@ss:w/rd?#&=+%"
    const encoded = run(`arciin_urlencode_db_password ${JSON.stringify(raw)}`).trim()
    expect(encoded).not.toContain("@")
    expect(encoded).not.toContain(":")
    expect(encoded).not.toContain("/")
    const url = run(
      `arciin_format_database_url arciin "${encoded}" localhost 5432 arciin`,
    ).trim()
    const parsed = new URL(url)
    expect(decodeURIComponent(parsed.password)).toBe(raw)
  })

  it("restricts .env permissions", () => {
    const file = path.join(tmpdir(), `arciin-env-perm-${Date.now()}`)
    writeFileSync(file, "DATABASE_URL=postgresql://arciin:x@localhost:5432/arciin\n")
    chmodSync(file, 0o644)
    run(`arciin_restrict_env_perms "${file}"`)
    expect(readFileSync(file, "utf8")).toContain("DATABASE_URL=")
    const mode = execFileSync("stat", ["-c", "%a", file], { encoding: "utf8" }).trim()
    expect(mode).toBe("600")
    rmSync(file, { force: true })
  })

  it("fails clearly when no credential can be resolved", () => {
    const file = path.join(tmpdir(), `arciin-env-empty-${Date.now()}`)
    writeFileSync(file, "NODE_ENV=production\n")
    expect(() => run(`arciin_resolve_db_password "${file}" 0 || exit 2`)).toThrow()
    rmSync(file, { force: true })
  })

  it("does not treat the example placeholder as a kept secret on a fresh install", () => {
    const file = path.join(tmpdir(), `arciin-env-placeholder-${Date.now()}`)
    writeFileSync(file, "DATABASE_URL=postgresql://arciin:arciin@localhost:5432/arciin\n")
    const generated = run(`arciin_resolve_db_password "${file}" 1`).trim()
    expect(generated).not.toBe("arciin")
    rmSync(file, { force: true })
  })

  it("fresh-install helpers never echo the password", () => {
    const dir = path.join(tmpdir(), `arciin-dbcred-log-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    try {
      const envFile = path.join(dir, ".env")
      writeFileSync(envFile, "DATABASE_URL=postgresql://arciin:arciin@localhost:5432/arciin\n")
      const password = run(`arciin_resolve_db_password "${envFile}" 1`).trim()
      const encoded = run(`arciin_urlencode_db_password "${password}"`).trim()
      const url = run(
        `arciin_format_database_url arciin "${encoded}" localhost 5432 arciin`,
      ).trim()
      const installerLog = [
        "Database credentials generated successfully.",
        "PostgreSQL role/database ready (port 5432)",
      ].join("\n")
      expect(installerLog).not.toContain(password)
      expect(installerLog).not.toContain(url)
      expect(run(`arciin_log_leaks_secret ${JSON.stringify(installerLog)} "${password}"; echo $?`).trim()).toBe(
        "1",
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("removed the hardcoded installer password from native install paths", () => {
    const install = readFileSync(path.join(ROOT, "install.sh"), "utf8")
    const init = readFileSync(path.join(ROOT, "scripts/arciin-init.sh"), "utf8")
    const restore = readFileSync(path.join(ROOT, "scripts/restore-migration-backup.sh"), "utf8")
    expect(install).not.toMatch(/PASSWORD 'arciin'/)
    expect(install).not.toMatch(/postgresql:\/\/arciin:arciin@/)
    expect(init).not.toMatch(/postgresql:\/\/arciin:arciin@/)
    expect(restore).not.toMatch(/postgresql:\/\/arciin:arciin@/)
  })
})

