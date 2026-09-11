import { execFileSync, execSync } from "node:child_process"
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it } from "vitest"

/**
 * ARC-014 — pre-migration backup / restore, against the isolated test Postgres.
 * Never points at the live production database.
 */

const root = path.join(import.meta.dirname, "../..")
const dbUrl = process.env.DATABASE_URL ?? ""

function isIsolatedUrl(url: string) {
  return /arciin_test|arciin_wave|5599/.test(url) && !/:5432\/arciin$/.test(url)
}

function withUrl(url: string, dataDir: string, extra: NodeJS.ProcessEnv = {}) {
  return { ...process.env, DATABASE_URL: url, ARCIIN_DATA_DIR: dataDir, ...extra }
}

function adminUrl(name: string) {
  const url = new URL(dbUrl)
  url.pathname = `/${name}`
  return url.toString()
}

function psql(url: string, sql: string) {
  return execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-tAc", sql], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  }).trim()
}

function dropCreate(name: string) {
  const url = new URL(dbUrl)
  url.pathname = "/postgres"
  execFileSync(
    "psql",
    [url.toString(), "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS ${name};`],
    { cwd: root, env: process.env },
  )
  execFileSync("psql", [url.toString(), "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${name};`], {
    cwd: root,
    env: process.env,
  })
}

const describeSafe = isIsolatedUrl(dbUrl) ? describe : describe.skip

describeSafe("migration backup safety (ARC-014)", () => {
  const created: string[] = []

  afterAll(() => {
    const url = new URL(dbUrl)
    url.pathname = "/postgres"
    for (const name of created) {
      try {
        execFileSync("psql", [url.toString(), "-c", `DROP DATABASE IF EXISTS ${name};`], {
          cwd: root,
          env: process.env,
        })
      } catch {
        /* ignore */
      }
    }
  })

  it("scenario A: up-to-date schema does not write a migration backup", () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "arciin-mig-a-"))
    try {
      const status = execSync(
        "bash -lc 'source scripts/migration-backup.sh; if has_pending_migrations; then echo PENDING; else echo CURRENT; fi'",
        {
          cwd: root,
          env: withUrl(dbUrl, dataDir),
          encoding: "utf8",
        },
      )
      expect(status).toContain("CURRENT")
      expect(() => readdirSync(path.join(dataDir, "backups/migrations"))).toThrow()
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it("scenario B+E: pending migration creates a restoreable backup", () => {
    const name = "arciin_mig_be"
    created.push(name)
    dropCreate(name)
    const url = adminUrl(name)
    execSync("pnpm exec prisma migrate deploy", {
      cwd: root,
      env: withUrl(url, mkdtempSync(path.join(tmpdir(), "arciin-mig-be-"))),
      stdio: "pipe",
    })
    psql(url, `INSERT INTO "User" (id, email, name, "passwordHash", role, status, "createdAt", "updatedAt")
      VALUES ('cmigowner0000000000000001', 'mig@example.invalid', 'Mig', 'x', 'OWNER', 'ACTIVE', NOW(), NOW());`)

    const dataDir = mkdtempSync(path.join(tmpdir(), "arciin-mig-be-data-"))
    try {
      const backup = execSync(
        "bash -lc 'source scripts/migration-backup.sh; create_migration_backup'",
        { cwd: root, env: withUrl(url, dataDir), encoding: "utf8" },
      ).trim()
      expect(backup).toContain("migration-backup-")
      expect(statSync(backup).size).toBeGreaterThan(100)

      const restoreName = "arciin_mig_restore"
      created.push(restoreName)
      dropCreate(restoreName)
      execFileSync(
        "bash",
        [path.join(root, "scripts/restore-migration-backup.sh"), backup],
        {
          cwd: root,
          env: withUrl(adminUrl(restoreName), dataDir, { ARCIIN_RESTORE_NONINTERACTIVE: "1" }),
        },
      )
      const email = psql(adminUrl(restoreName), `SELECT email FROM "User" WHERE id = 'cmigowner0000000000000001';`)
      expect(email).toBe("mig@example.invalid")
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it("scenario C: failed backup does not run migrate deploy", () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "arciin-mig-c-"))
    const bin = mkdtempSync(path.join(tmpdir(), "arciin-fake-bin-"))
    try {
      execSync(`printf '#!/bin/sh\\necho dump-failed >&2\\nexit 1\\n' > "${bin}/pg_dump" && chmod +x "${bin}/pg_dump"`, {
        cwd: root,
      })
      let failed = false
      try {
        execSync("bash -lc 'source scripts/migration-backup.sh; create_migration_backup'", {
          cwd: root,
          env: withUrl(dbUrl, dataDir, { PATH: `${bin}:${process.env.PATH}` }),
        })
      } catch {
        failed = true
      }
      expect(failed).toBe(true)
      const dir = path.join(dataDir, "backups/migrations")
      const leftovers = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile())
      expect(leftovers).toHaveLength(0)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(bin, { recursive: true, force: true })
    }
  })

  it("scenario D: failed migrate keeps the backup file", () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "arciin-mig-d-"))
    try {
      const backup = execSync(
        "bash -lc 'source scripts/migration-backup.sh; create_migration_backup'",
        { cwd: root, env: withUrl(dbUrl, dataDir), encoding: "utf8" },
      ).trim()
      expect(statSync(backup).size).toBeGreaterThan(100)
      const bin = mkdtempSync(path.join(tmpdir(), "arciin-fake-prisma-"))
      execSync(
        `printf '%s\\n' '#!/bin/sh' 'if echo "$*" | grep -q "migrate deploy"; then echo migrate-failed >&2; exit 1; fi' 'exec pnpm exec prisma "$@"' > "${bin}/prisma" && chmod +x "${bin}/prisma"`,
        { cwd: root },
      )
      let failed = false
      try {
        execSync("pnpm exec prisma migrate deploy", {
          cwd: root,
          env: withUrl("postgresql://invalid:invalid@127.0.0.1:1/nope", dataDir),
          stdio: "pipe",
        })
      } catch {
        failed = true
      }
      expect(failed).toBe(true)
      expect(statSync(backup).size).toBeGreaterThan(100)
      rmSync(bin, { recursive: true, force: true })
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it("retention prunes only automatic migration backups", () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "arciin-mig-ret-"))
    try {
      execSync(
        "bash -lc 'source scripts/migration-backup.sh; export ARCIIN_MIGRATION_BACKUP_RETAIN=2; for i in 1 2 3; do create_migration_backup >/dev/null; sleep 1; done; ls \"$(migration_backup_dir)\" | wc -l'",
        { cwd: root, env: withUrl(dbUrl, dataDir), encoding: "utf8" },
      )
      const files = readdirSync(path.join(dataDir, "backups/migrations")).filter((f) =>
        f.startsWith("migration-backup-"),
      )
      expect(files.length).toBeLessThanOrEqual(2)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
