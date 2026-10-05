import { execFileSync, spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it } from "vitest"

/**
 * Native database credentials under the installer's real shell options.
 *
 * The owner hit this on Ubuntu 26.04.1, at "Redis & PostgreSQL", with an
 * existing .env (from a Docker install) and the storage path switched to a
 * native one:
 *
 *   scripts/lib/db-credentials.sh: line 101: raw: unbound variable
 *   ✖ Could not resolve a database password. …
 *
 * `local url encoded raw` left `raw` unset whenever .env had no DATABASE_URL,
 * and install.sh runs with `set -Eeuo pipefail`. The earlier tests ran without
 * `set -u`, so they could not see it. Everything here runs strict.
 */

const ROOT = path.resolve(import.meta.dirname, "..")
const LIB = path.join(ROOT, "scripts/lib/db-credentials.sh")
const INSTALL = path.join(ROOT, "install.sh")
const scratch = mkdtempSync(path.join(tmpdir(), "arciin-dbcred-strict-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

let n = 0
function envFile(content: string) {
  n += 1
  const file = path.join(scratch, `env-${n}`)
  writeFileSync(file, content, { mode: 0o600 })
  return file
}

/** Run under `set -Eeuo pipefail` like install.sh. Never throws; returns everything. */
function strict(script: string, env: NodeJS.ProcessEnv = {}) {
  const res = spawnSync("bash", ["-c", `set -Eeuo pipefail\nsource "${LIB}"\n${script}`], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
  return { code: res.status, stdout: res.stdout, stderr: res.stderr }
}

/** Resolve into a variable and report source/state/length — never the password itself. */
function resolve(file: string, fresh: 0 | 1, backup = "") {
  const r = strict(
    `arciin_resolve_db_password_into pw "${file}" ${fresh} "${backup}"
     printf 'source=%s state=%s len=%s\\n' "$ARCIIN_DB_PASSWORD_SOURCE" "$ARCIIN_DB_URL_STATE" "\${#pw}"
     printf '%s' "$pw" > "${scratch}/resolved-${n}"`,
  )
  const password = r.code === 0 ? readFileSync(path.join(scratch, `resolved-${n}`), "utf8") : ""
  return { ...r, password }
}

const DOCKER_STYLE_ENV = [
  "NODE_ENV=production",
  "ARCIIN_HOST_DATA_DIR=/srv/arciin-storage/arciin",
  "ARCIIN_DATA_DIR=/srv/arciin-storage/arciin",
  "POSTGRES_PASSWORD=0123456789abcdef0123456789abcdef0123456789abcdef",
  "REDIS_PASSWORD=fedcba9876543210fedcba9876543210fedcba9876543210",
  "SESSION_SECRET=s3cr3t",
  "",
].join("\n")

describe("the owner's failure (Ubuntu 26.04.1, existing .env, no DATABASE_URL)", () => {
  it("is impossible: no unbound variable, a password is resolved, nothing is printed", () => {
    const file = envFile(DOCKER_STYLE_ENV)
    const r = resolve(file, 0)
    expect(r.stderr).not.toMatch(/unbound variable/)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("source=generated state=missing len=48")
    expect(r.stdout + r.stderr).not.toContain(r.password)
  })

  it("the legacy wrapper the old installer called does not abort under set -u either", () => {
    const file = envFile(DOCKER_STYLE_ENV)
    const r = strict(`arciin_resolve_db_password "${file}" 0 >/dev/null; echo survived`)
    expect(r.stderr).not.toMatch(/unbound variable/)
    expect(r.stdout.trim()).toBe("survived")
  })
})

describe("credential resolution, strict mode", () => {
  it("1. an existing valid DATABASE_URL is kept (repair keeps the password)", () => {
    const file = envFile("DATABASE_URL=postgresql://arciin:k33p%2Fme%40x@localhost:5432/arciin\n")
    const r = resolve(file, 0)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("source=env state=ok")
    expect(r.password).toBe("k33p/me@x")
  })

  it("2. DATABASE_URL missing → a controlled new password, never a crash", () => {
    const r = resolve(envFile("NODE_ENV=production\n"), 0)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("source=generated state=missing")
    expect(r.password).toMatch(/^[0-9a-f]{48}$/)
  })

  it.each([
    ["no password", "DATABASE_URL=postgresql://arciin@localhost:5432/arciin"],
    ["not a URL", "DATABASE_URL=this is not a url"],
    ["wrong scheme", "DATABASE_URL=mysql://arciin:pw@localhost/arciin"],
    ["bad port", "DATABASE_URL=postgresql://arciin:pw@localhost:notaport/arciin"],
    ["empty value", "DATABASE_URL="],
  ])("3. DATABASE_URL malformed (%s) → diagnosed, new password, no crash", (_label, line) => {
    const r = resolve(envFile(`${line}\n`), 0)
    expect(r.stderr).not.toMatch(/unbound variable/)
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/source=generated state=(malformed|missing)/)
    expect(r.password).toMatch(/^[0-9a-f]{48}$/)
  })

  it("6. an old failed install's partial .env (example placeholder) is never treated as a real password", () => {
    const example = readFileSync(path.join(ROOT, ".env.example"), "utf8")
    const r = resolve(envFile(example), 0)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain("source=generated")
    expect(r.password).not.toBe("arciin")
  })

  it("repair recovers the password from the installer's .env backup when .env lost it", () => {
    const backup = envFile("DATABASE_URL=postgresql://arciin:from-backup-42@localhost:5432/arciin\n")
    const r = resolve(envFile(DOCKER_STYLE_ENV), 0, backup)
    expect(r.stdout).toContain("source=backup state=missing")
    expect(r.password).toBe("from-backup-42")
  })

  it("a fresh install generates, and never reuses the backup of a previous install", () => {
    const backup = envFile("DATABASE_URL=postgresql://arciin:old-install@localhost:5432/arciin\n")
    const r = resolve(envFile("DATABASE_URL=postgresql://arciin:arciin@localhost:5432/arciin\n"), 1, backup)
    expect(r.stdout).toContain("source=generated")
    expect(r.password).not.toBe("old-install")
  })

  it("7. set -u: a missing env file, empty arguments and unset globals are all safe", () => {
    const r = strict(
      `unset ARCIIN_DB_PASSWORD_SOURCE ARCIIN_DB_URL_STATE
       arciin_resolve_db_password_into pw "${scratch}/does-not-exist" 0 ""
       arciin_resolve_db_password_into pw2 "" ""
       arciin_db_password_from_env_into x "${scratch}/does-not-exist"
       echo "ok \${#pw} \${#pw2} [\${x}] \${ARCIIN_DB_URL_STATE}"`,
    )
    expect(r.stderr).not.toMatch(/unbound variable/)
    expect(r.stdout.trim()).toBe("ok 48 48 [] missing")
  })

  it("never writes the password to stdout or stderr", () => {
    const file = envFile("DATABASE_URL=postgresql://arciin:d0-not-print-me@localhost:5432/arciin\n")
    const r = strict(`arciin_resolve_db_password_into pw "${file}" 0; echo done`)
    expect(r.stdout + r.stderr).not.toContain("d0-not-print-me")
  })
})

/**
 * The installer's own functions, extracted from install.sh and run with
 * PostgreSQL stubbed: what SQL would reach the server, and what lands in .env.
 */
function installerFn(name: string) {
  const src = readFileSync(INSTALL, "utf8")
  const start = src.indexOf(`${name}() {`)
  expect(start, name).toBeGreaterThan(-1)
  return src.slice(start, src.indexOf("\n}\n", start) + 2)
}

function stubbedInstaller(opts: { roleExists: boolean; envContent: string; authBefore?: string }) {
  n += 1
  const dir = path.join(scratch, `root-${n}`)
  const bin = path.join(dir, "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(path.join(dir, ".env"), opts.envContent, { mode: 0o600 })
  for (const tool of ["psql", "pg_isready"]) {
    writeFileSync(path.join(bin, tool), "#!/bin/sh\nexit 0\n")
    chmodSync(path.join(bin, tool), 0o755)
  }
  const sqlLog = path.join(dir, "sql.log")
  const script = `
ROOT_DIR="${dir}"
DEFAULT_PG_PORT=5432
RESET_DB=false
ARCIIN_FRESH_INSTALL=0
JOURNAL_DIR="${dir}/state"
ok() { echo "ok: $1"; }
warn() { echo "warn: $1"; }
fail() { echo "fail: $1"; exit 1; }
arciin_fail_report() { echo "fail-report: $1"; exit 1; }
arciin_journal_path() { echo "$JOURNAL_DIR/install-state.json"; }
arciin_journal_step() { :; }
_resolve_postgres_port() { echo 5432; }
_port_has_postgres() { return 0; }
_port_in_use() { return 0; }
maybe_reconfigure_postgresql_port() { :; }
# Called in $(…) subshells, so the count lives in a file.
arciin_probe_db_auth() {
  local calls
  calls=$(( $(cat "${dir}/auth-calls" 2>/dev/null || echo 0) + 1 ))
  echo "$calls" > "${dir}/auth-calls"
  if [[ $calls -eq 1 ]]; then echo "${opts.authBefore ?? "auth_failed"}"; else echo ok; fi
}
sudo() {
  local args="$*"
  case "$args" in
    *"FROM pg_roles"*) ${opts.roleExists ? 'echo 1' : 'echo ""'} ;;
    *"FROM pg_database"*) echo 1 ;;
    *"-v pwd="*)
      local pwd_arg=""
      for a in "$@"; do [[ "$a" == pwd=* ]] && pwd_arg="\${a#pwd=}"; done
      { printf 'SQL: %s\\n' "$(cat)"; printf 'PWD_MATCHES_ENV: %s\\n' "$([[ "$pwd_arg" == "$ARCIIN_DB_PASSWORD" ]] && echo yes || echo no)"; } >> "${sqlLog}"
      ;;
    *) printf 'OTHER: %s\\n' "$args" >> "${sqlLog}" ;;
  esac
}
${installerFn("_set_env_kv")}
${installerFn("configure_postgres_port")}
${installerFn("ensure_postgres_role_and_db")}
configure_postgres_port
ensure_postgres_role_and_db
echo "finished"
`
  const r = strict(script, { PATH: `${bin}:${process.env.PATH}` })
  const env = readFileSync(path.join(dir, ".env"), "utf8")
  let sql = ""
  try {
    sql = readFileSync(sqlLog, "utf8")
  } catch {
    sql = ""
  }
  return { ...r, env, sql }
}

describe("installer database step, PostgreSQL stubbed, strict mode", () => {
  it("5. missing PostgreSQL role → CREATE ROLE with the password now in .env", () => {
    // No role yet: the only login probe is the final proof, which succeeds.
    const r = stubbedInstaller({ roleExists: false, envContent: DOCKER_STYLE_ENV, authBefore: "ok" })
    expect(r.stderr).not.toMatch(/unbound variable/)
    expect(r.stdout).toContain("finished")
    expect(r.sql).toContain("SQL: CREATE ROLE arciin WITH LOGIN PASSWORD :'pwd' CREATEDB;")
    expect(r.sql).toContain("PWD_MATCHES_ENV: yes")
    expect(r.env).toMatch(/^DATABASE_URL=postgresql:\/\/arciin:[0-9a-f]{48}@localhost:5432\/arciin$/m)
  })

  it("4. existing PostgreSQL role whose password .env no longer has → re-aligned, data untouched", () => {
    const r = stubbedInstaller({ roleExists: true, envContent: DOCKER_STYLE_ENV, authBefore: "auth_failed" })
    expect(r.stdout).toContain("finished")
    expect(r.sql).toContain("SQL: ALTER ROLE arciin WITH LOGIN PASSWORD :'pwd' CREATEDB;")
    expect(r.sql).not.toMatch(/DROP|CREATE DATABASE/)
    expect(r.stdout).toContain("Database role password realigned")
  })

  it("4b. existing role with a working DATABASE_URL → kept as is, no ALTER", () => {
    const r = stubbedInstaller({
      roleExists: true,
      envContent: "DATABASE_URL=postgresql://arciin:still-good-pw@localhost:5432/arciin\n",
      authBefore: "ok",
    })
    expect(r.stdout).toContain("ok: Existing database credentials kept")
    expect(r.sql).not.toContain("ALTER ROLE")
    expect(r.env).toContain("postgresql://arciin:still-good-pw@localhost:5432/arciin")
  })

  it("8. Ubuntu 26.04 native path: Docker .env + native storage → completes, host rewritten to localhost, .env saved first", () => {
    const r = stubbedInstaller({
      roleExists: false,
      envContent: DOCKER_STYLE_ENV,
      authBefore: "ok",
    })
    expect(r.stderr).not.toMatch(/unbound variable/)
    expect(r.stdout).toContain(".env has no DATABASE_URL")
    expect(r.stdout).toContain("finished")
    expect(r.env).toMatch(/^DATABASE_URL=postgresql:\/\/arciin:[0-9a-f]{48}@localhost:5432\/arciin$/m)
    // The pre-credentials copy keeps everything that was there.
    const saved = execFileSync("bash", ["-c", `cat "${scratch}"/root-${n}/state/env-backups/pre-credentials-*.env`], {
      encoding: "utf8",
    })
    expect(saved).toContain("POSTGRES_PASSWORD=")
    // Nothing printed the generated password.
    const generated = /arciin:([0-9a-f]{48})@/.exec(r.env)?.[1] ?? "missing"
    expect(r.stdout + r.stderr).not.toContain(generated)
  })

  it("8b. a Docker DATABASE_URL pointing at the Compose service is rewritten to localhost", () => {
    const r = stubbedInstaller({
      roleExists: true,
      envContent: "DATABASE_URL=postgresql://arciin:dockerpw123@postgres:5432/arciin\n",
      authBefore: "auth_failed",
    })
    expect(r.env).toContain("postgresql://arciin:dockerpw123@localhost:5432/arciin")
  })
})
