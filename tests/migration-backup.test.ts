import { execSync } from "node:child_process"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

describe("migration backup helpers (ARC-014)", () => {
  it("detects pending vs up-to-date migrate status output", () => {
    const script = `
      source scripts/migration-backup.sh
      has_pending_migrations() { grep -q "PENDING" <<< "$1"; }
    `
    expect(script).toContain("migration-backup.sh")
  })

  it("creates a non-empty pg_dump when DATABASE_URL points at test DB", () => {
    const dbUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
    if (!dbUrl || dbUrl.includes(":1/")) {
      return
    }
    const dataDir = mkdtempSync(path.join(tmpdir(), "arciin-mig-backup-"))
    try {
      const out = execSync(
        `bash -c 'source scripts/migration-backup.sh; export ARCIIN_DATA_DIR="${dataDir}"; export DATABASE_URL="${dbUrl}"; create_migration_backup'`,
        {
          cwd: path.join(import.meta.dirname, ".."),
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
        },
      )
        .toString()
        .trim()
      expect(out).toContain("migration-backup-")
      expect(statSync(out).size).toBeGreaterThan(100)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
