import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Native installer safety contracts (v1.1.4).
 *
 * Each of these was a real failure on a new server or a destructive default.
 * The end-to-end proof runs on disposable VMs (.github/workflows/install-vm.yml);
 * these pin the source so the same mistakes cannot quietly come back.
 */

const ROOT = path.resolve(import.meta.dirname, "..")
const install = readFileSync(path.join(ROOT, "install.sh"), "utf8")
const init = readFileSync(path.join(ROOT, "scripts/arciin-init.sh"), "utf8")
const backup = readFileSync(path.join(ROOT, "scripts/migration-backup.sh"), "utf8")

function fn(name: string) {
  const start = install.indexOf(`${name}() {`)
  expect(start, `${name} exists`).toBeGreaterThan(-1)
  const end = install.indexOf("\n}\n", start)
  return install.slice(start, end)
}

describe("never destructive by default", () => {
  it("the existing-install menu defaults to Repair, and Enter keeps the data", () => {
    const body = fn("maybe_handle_existing_arciin_db")
    expect(body).toContain('local choice="1"')
    expect(body).toContain('read -r -p "  Choice [1]: " choice')
    expect(body).toContain('choice="${choice:-1}"')
    expect(body).toMatch(/1\)\$\{RESET\} Repair \/ keep existing data.*\[default\]/)
    // The old prompt defaulted to wipe in a fresh folder.
    expect(install).not.toMatch(/default w\)/)
    expect(install).not.toContain('_db_choice="${_db_choice:-w}"')
  })

  it("every erase goes through the typed phrase, never Enter or y", () => {
    for (const name of ["maybe_handle_existing_arciin_db", "native_uninstall"]) {
      expect(fn(name)).toMatch(/native_confirm_fresh|arciin_confirm_typed "ERASE ARCIIN"/)
    }
    expect(fn("native_confirm_fresh")).toContain('arciin_confirm_typed "ERASE ARCIIN"')
    expect(fn("native_uninstall")).toContain('arciin_confirm_typed "DELETE FILES"')
  })

  it("--reset-db is an alias for --fresh (confirmed), not a silent drop", () => {
    expect(install).toMatch(/--reset-db\) ARCIIN_MODE=fresh/)
  })

  it("an unrelated database named arciin stops the install instead of being migrated or erased", () => {
    const body = fn("maybe_handle_existing_arciin_db")
    expect(body).toContain('"$state" == "foreign"')
    expect(body).toContain("That database has NOT been touched.")
  })

  it("--fresh says exactly what is removed and that files are kept", () => {
    const body = fn("native_confirm_fresh")
    expect(body).toContain("Fresh install will remove:")
    expect(body).toContain("NOT deleted")
    expect(body).toContain("arciin.com/account")
  })

  it("plain --uninstall keeps database, files and .env", () => {
    const body = fn("native_uninstall")
    expect(body).toContain('if [[ "$ARCIIN_DELETE_DATA" != "1" ]]; then')
    expect(body.indexOf("exit 0")).toBeLessThan(body.indexOf("drop_arciin_database"))
  })

  it("a repair backs up the database before touching anything", () => {
    expect(fn("maybe_handle_existing_arciin_db")).toContain("native_pre_repair_backup")
    expect(fn("native_pre_repair_backup")).toContain("pg_dump -Fc arciin")
  })
})

describe("fresh-server failures", () => {
  it("PM2 is installed with sudo when npm's global prefix is not writable", () => {
    const body = fn("ensure_pm2")
    expect(body).toContain("npm config get prefix")
    expect(body).toContain("sudo npm install -g pm2")
  })

  it("boot persistence is verified: unit enabled and Arciin in PM2's saved list", () => {
    const body = fn("ensure_pm2_boot")
    expect(body).toContain('systemctl is-enabled "$unit"')
    expect(body).toContain("dump.pm2")
    for (const name of ["arciin-api", "arciin-worker", "arciin-web"]) expect(body).toContain(name)
    // No more `pm2 startup | grep sudo | eval` with errors swallowed.
    expect(install).not.toMatch(/pm2 startup 2>&1 \| grep sudo/)
  })

  it("a missing TERM does not abort the install (clear only on a terminal)", () => {
    expect(install).not.toMatch(/^clear$/m)
    expect(install).toContain("if [[ -t 1 ]]; then clear 2>/dev/null || true; fi")
  })

  it("the web build is swapped from .next-build into .next (arciin-web needs .next/BUILD_ID)", () => {
    // build:web writes to .next-build; without the swap a native install had
    // no web build at all and arciin-web restarted forever.
    expect(readFileSync(path.join(ROOT, "package.json"), "utf8")).toContain("NEXT_DIST_DIR=.next-build")
    const body = fn("promote_web_build")
    expect(body).toContain('mv "$stage" "$live"')
    expect(body).toContain("verify-web-assets.mjs")
    expect(install).toMatch(/pnpm build"\n\s+promote_web_build/)
  })

  it("apt never prompts and the system upgrade is opt-in", () => {
    expect(install).toContain("export DEBIAN_FRONTEND=noninteractive")
    expect(install).toContain("export NEEDRESTART_MODE=a")
    expect(install).toContain('if [[ "${ARCIIN_UPGRADE_SYSTEM:-0}" == "1" ]]; then')
  })

  it("low memory is caught before the build, not by the OOM killer", () => {
    expect(fn("preflight_resources")).toMatch(/mem_mb \+ swap_mb < 3500/)
  })

  it("a missing storage mount stops the install unless --allow-root-storage", () => {
    expect(install).toContain("arciin_storage_mount_missing")
    expect(install).toContain("--allow-root-storage")
  })
})

describe("database credentials are tested, not assumed", () => {
  it("the installer proves an authenticated login with the .env credentials", () => {
    const body = fn("ensure_postgres_role_and_db")
    expect(body).toContain("arciin_probe_db_auth")
    expect(body).toContain("PostgreSQL is running, but a login with the credentials in .env failed.")
  })

  it("role passwords are set through psql's script input, where :'pwd' is substituted", () => {
    // psql -c does not interpolate variables: the role was never created.
    expect(install).not.toMatch(/-c "(CREATE|ALTER) ROLE arciin[^"]*:'pwd'/)
    expect(install).toMatch(/printf '%s\\n' "CREATE ROLE arciin WITH LOGIN PASSWORD :'pwd' CREATEDB;" \\\n\s+\| sudo -u postgres/)
  })

  it("arciin-init reports wrong credentials as credentials, before any migration", () => {
    expect(init).toContain("check_database_login")
    expect(init.indexOf("check_database_login\nrun_migrations")).toBeGreaterThan(-1)
    expect(init).toContain("Arciin cannot authenticate with the configured credentials")
    expect(init).toContain("Your data: NOT deleted")
  })

  it("pending migrations on a fresh database do not end arciin-init (set -e)", () => {
    // `prisma migrate status` exits 1 whenever migrations are pending. The
    // check used to be a bare assignment, so under `set -e` the script died
    // silently and the Docker API container restarted forever.
    const out = execSync(
      `bash -c 'set -euo pipefail; log() { echo "$1"; }; pnpm() { echo "Following migrations have not yet been applied:"; return 1; }; source <(sed -n "/^check_database_login() {/,/^}/p" scripts/arciin-init.sh); check_database_login; echo survived'`,
      { cwd: ROOT, encoding: "utf8" },
    ).trim()
    expect(out).toMatch(/survived$/)
  })

  it("the readiness wait names the database user (container uids without a passwd entry)", () => {
    expect(init).toMatch(/pg_isready -h "\$\{host\}" -p "\$\{port\}" \$\{user:\+-U "\$user"\}/)
  })

  it("an unreadable migration status is no longer reported as 'up to date'", () => {
    expect(backup).toMatch(/return 2\n}/)
    const out = execSync(
      `bash -c 'pnpm() { echo "Error: P1000: Authentication failed"; return 1; }; export -f pnpm; source scripts/migration-backup.sh; rc=0; has_pending_migrations || rc=$?; echo "rc=$rc"'`,
      { cwd: ROOT, encoding: "utf8" },
    ).trim()
    expect(out).toBe("rc=2")
  })
})
