import { execSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it } from "vitest"

/**
 * The installer's state classifier (scripts/lib/install-state.sh): facts in,
 * one state word out. These words decide whether an install repairs, refuses
 * or offers to erase — so every state, and especially the ones that must
 * never be treated as "safe to wipe", is pinned here.
 */

const ROOT = path.resolve(import.meta.dirname, "..")
const LIB = path.join(ROOT, "scripts/lib/install-state.sh")
const scratch = mkdtempSync(path.join(tmpdir(), "arciin-install-state-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function sh(script: string, env: NodeJS.ProcessEnv = {}, input?: string) {
  return execSync(`source "${LIB}"; ${script}`, {
    cwd: ROOT,
    encoding: "utf8",
    shell: "/bin/bash",
    env: { ...process.env, ARCIIN_JOURNAL: path.join(scratch, "journal.json"), ...env },
    input,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim()
}

describe("database state", () => {
  // exists tables has_migrations has_instance has_user failed
  it.each([
    ["no database", "0 0 0 0 0 0", "missing"],
    ["no tables", "1 0 0 0 0 0", "empty"],
    ["an unrelated database named arciin", "1 12 0 0 0 0", "foreign"],
    ["another Prisma app", "1 9 1 0 0 0", "foreign"],
    ["first migration failed early", "1 1 1 0 0 0", "partial_arciin"],
    ["Arciin schema, InstanceConfig missing", "1 30 1 0 1 0", "partial_arciin"],
    ["Arciin schema, a failed migration", "1 44 1 1 1 1", "partial_arciin"],
    ["complete Arciin schema", "1 44 1 1 1 0", "valid_arciin"],
  ])("%s → %s", (_label, facts, state) => {
    expect(sh(`arciin_classify_db ${facts}`)).toBe(state)
  })

  it("an unrelated database is never 'empty' (it must not be migrated into or wiped)", () => {
    expect(sh("arciin_classify_db 1 3 0 0 0 0")).not.toBe("empty")
  })

  it.each([
    ["2", "1", "claimed"],
    ["0", "1", "partial"],
    ["0", "0", "unclaimed"],
  ])("claim state for users=%s instances=%s → %s", (users, instances, state) => {
    expect(sh(`arciin_classify_db_claim ${users} ${instances}`)).toBe(state)
  })

  it.each([
    ["0", "", "ok"],
    ["2", 'psql: error: FATAL:  password authentication failed for user "arciin"', "auth_failed"],
    ["1", "Error: P1000: Authentication failed against database server", "auth_failed"],
    ["2", 'FATAL:  database "arciin" does not exist', "missing_database"],
    ["2", "connection to server at \"127.0.0.1\", port 5432 failed: Connection refused", "unreachable"],
    ["2", "something else", "error"],
  ])("auth: exit %s → %s", (code, err, state) => {
    expect(sh(`arciin_classify_db_auth ${code} ${JSON.stringify(err)}`)).toBe(state)
  })
})

describe("storage state", () => {
  // exists entries layout writable read_only owner_ok mount_missing
  it.each([
    ["mount missing beats everything", "1 5 1 1 0 1 1", "mount_missing"],
    ["does not exist", "0 0 0 0 0 1 0", "missing"],
    ["read-only filesystem", "1 3 1 0 1 0 0", "read_only"],
    ["not writable by this user", "1 3 1 0 0 0 0", "wrong_owner"],
    ["empty directory", "1 0 0 1 0 1 0", "empty"],
    ["an Arciin storage root", "1 6 1 1 0 1 0", "valid_arciin"],
    ["something else is in there", "1 4 0 1 0 1 0", "partial"],
  ])("%s → %s", (_label, facts, state) => {
    expect(sh(`arciin_classify_storage ${facts}`)).toBe(state)
  })

  it("probes a real directory: writable, classified, probe file cleaned up", () => {
    const dir = path.join(scratch, "store")
    mkdirSync(path.join(dir, "objects"), { recursive: true })
    expect(sh(`arciin_probe_storage_state "${dir}"`)).toBe("valid_arciin")
    expect(sh(`ls -A "${dir}"`)).toBe("objects")
    expect(sh(`arciin_probe_storage_state "${path.join(scratch, "nope")}"`)).toBe("missing")
  })

  it("a path under /mnt whose disk is not mounted is mount_missing, not a folder to create", () => {
    expect(sh(`arciin_storage_mount_missing /mnt/arciin-test-disk-that-is-not-mounted/arciin`)).toBe("1")
    expect(sh(`arciin_storage_mount_missing "${path.join(scratch, "store")}"`)).toBe("0")
    expect(
      sh(`arciin_storage_mount_missing "${path.join(scratch, "store")}"`, { ARCIIN_STORAGE_REQUIRE_MOUNT: "1" }),
    ).toMatch(/^[01]$/)
  })
})

describe("native and Docker state", () => {
  // env pm2 online defined services build
  it.each([
    ["nothing installed", "0 0 0 0 1 0", "none"],
    ["Postgres/Redis not running", "1 1 3 3 0 1", "services_missing"],
    ["no pm2", "1 0 0 0 1 1", "pm2_missing"],
    ["env written, never built", "1 1 0 0 1 0", "partial"],
    ["built but processes gone", "1 1 0 0 1 1", "processes_missing"],
    ["processes defined but down", "1 1 1 3 1 1", "processes_missing"],
    ["installed", "1 1 3 3 1 1", "installed"],
  ])("native: %s → %s", (_label, facts, state) => {
    expect(sh(`arciin_classify_native ${facts}`)).toBe(state)
  })

  // total running expected volume env auth
  it.each([
    ["nothing", "0 0 6 0 0 unknown", "none"],
    ["config written, nothing created yet", "0 0 6 0 1 unknown", "none"],
    ["containers left without a database volume", "3 0 6 0 1 unknown", "stale_containers"],
    ["volume kept, .env lost", "0 0 6 1 0 unknown", "env_missing"],
    ["volume kept, .env lost, containers too", "6 6 6 1 0 unknown", "env_missing"],
    ["password does not match the volume", "6 4 6 1 1 auth_failed", "credential_mismatch"],
    ["volumes only", "0 0 6 1 1 ok", "existing_volumes"],
    ["stopped", "6 0 6 1 1 ok", "stopped"],
    ["half up", "6 3 6 1 1 ok", "partial"],
    ["running", "6 6 6 1 1 ok", "running"],
  ])("docker: %s → %s", (_label, facts, state) => {
    expect(sh(`arciin_classify_docker ${facts}`)).toBe(state)
  })
})

describe("journal", () => {
  it("records steps without secrets, mode 600, and answers 'done?'", () => {
    sh(`arciin_journal_set mode native; arciin_journal_step database`)
    const file = path.join(scratch, "journal.json")
    const data = JSON.parse(readFileSync(file, "utf8"))
    expect(data).toMatchObject({ mode: "native", "step.database": "done", lastCompletedStep: "database" })
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(sh(`arciin_journal_done database && echo yes || echo no`)).toBe("yes")
    expect(sh(`arciin_journal_done build && echo yes || echo no`)).toBe("no")
  })
})

describe("destructive confirmation", () => {
  it("only the exact typed phrase confirms — not Enter, not y, not yes", () => {
    const run = (value: string) =>
      sh(`arciin_confirm_typed "ERASE ARCIIN" </dev/null && echo confirmed || echo refused`, {
        ARCIIN_CONFIRM_ERASE: value,
      })
    expect(run("ERASE ARCIIN")).toBe("confirmed")
    for (const v of ["", "y", "yes", "Y", "erase arciin", "ERASE"]) expect(run(v)).toBe("refused")
  })

  it("the failure report always says what, why, data status and how to recover", () => {
    let out = ""
    try {
      sh(`arciin_fail_report "Database could not be opened" "The password does not match." "Your data has NOT been deleted." "Run ./install.sh --repair"`)
    } catch (error) {
      out = String((error as { stderr?: string }).stderr)
    }
    for (const part of ["Database could not be opened", "Why", "The password does not match.", "Your data", "NOT been deleted", "How to recover", "--repair"]) {
      expect(out).toContain(part)
    }
  })
})
