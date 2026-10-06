import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  MANIFEST_ASSETS,
  assetKey,
  buildManifest,
  serializeManifest,
} from "../scripts/release-manifest.mjs"

/**
 * The canonical Docker installer (v1.1.4). The end-to-end proof — fresh,
 * repair, lost .env, wrong password, --fresh, reboot — runs against real
 * Docker in .github/workflows/install-docker.yml; these pin the contracts.
 */

const ROOT = path.resolve(import.meta.dirname, "..")
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8")
const installer = read("scripts/docker-install.sh")
const production = read("docker-compose.production.yml")
const scratch = mkdtempSync(path.join(tmpdir(), "arciin-docker-installer-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function fn(name: string) {
  const start = installer.indexOf(`${name}() {`)
  expect(start, `${name} exists`).toBeGreaterThan(-1)
  return installer.slice(start, installer.indexOf("\n}\n", start))
}

const digest = (c: string) => `sha256:${c.repeat(64)}`
const sampleManifest = () =>
  buildManifest({
    version: "1.1.4",
    releaseSha: "a".repeat(40),
    registry: "ghcr.io/roberadesissaii-arc",
    digests: { web: digest("1"), api: digest("2"), worker: digest("3") },
    assetHashes: Object.fromEntries(MANIFEST_ASSETS.map((n, i) => [n, String(i).repeat(64)])),
    assetsBase: "https://github.com/Roberadesissaii-arc/arciin/releases/download/v1.1.4",
    publishedAt: "2026-10-05T00:00:00Z",
  })

describe("one canonical production Compose definition", () => {
  it("every service restarts unless stopped, and the project is named", () => {
    expect(production).toMatch(/^name: arciin$/m)
    const services = production.split(/^ {2}(?=[a-z]+:\n)/m).slice(1)
    expect(services).toHaveLength(6)
    for (const block of services) expect(block, block.split(":")[0]).toMatch(/restart: unless-stopped/)
  })

  it("has no floating :latest default — images come pinned from the manifest", () => {
    expect(production).not.toMatch(/:latest\}/)
    for (const v of ["WEB", "API", "WORKER"]) expect(production).toContain(`\${ARCIIN_IMAGE_${v}:?`)
  })

  it("the worker is health-checked, and the probe needs the database heartbeat", () => {
    expect(production).toMatch(/worker-healthcheck\.mjs/)
    const probe = read("scripts/worker-healthcheck.mjs")
    expect(probe).toContain("heartbeat:db")
    expect(read("apps/worker/src/index.ts")).toMatch(/\$queryRaw`SELECT 1`[\s\S]*HeartbeatKey\}:db`/)
  })

  it("the development compose says so, and every Docker entry point runs docker-install.sh", () => {
    expect(read("docker-compose.yml")).toMatch(/DEVELOPMENT ONLY/)
    expect(read("scripts/docker-setup.sh")).toMatch(/exec bash "\$ROOT_DIR\/scripts\/docker-install\.sh"/)
    expect(read("scripts/install-bootstrap.sh")).toMatch(/bash "\$work\/docker-install\.sh"/)
    expect(read("scripts/install-private.sh")).toMatch(/docker-setup\.sh/)
    expect(read("install.sh")).toMatch(/exec "\$\{ROOT_DIR\}\/scripts\/docker-setup\.sh" "\$\{_docker_args\[@\]\}"/)
  })
})

describe("credentials are never regenerated against an existing database", () => {
  it("a new .env is refused while a database volume exists (unless recovery chose a password)", () => {
    const body = fn("write_env")
    expect(body).toContain('if volume_exists && [[ -z "${NEW_PG_PASSWORD:-}" ]]; then')
    expect(body).toContain("Refusing to generate new credentials.")
    // The existing-.env branch never touches POSTGRES_PASSWORD.
    const keep = body.slice(body.indexOf("Existing ${ENV_FILE} kept"))
    expect(keep).not.toContain("POSTGRES_PASSWORD")
  })

  it("auth is tested over the network from a separate container, never via the trusted socket", () => {
    const body = fn("db_auth")
    expect(body).toContain('--network "${PROJECT}_default"')
    expect(body).toContain("psql -X -h postgres")
    expect(body).toContain("--env-file")
    expect(body).not.toMatch(/-e PGPASSWORD=/)
  })

  it("recovery defaults never lose data: restore, else re-key (wrong password), else cancel", () => {
    const body = fn("recover_credentials")
    expect(body).toMatch(/if \[\[ -n "\$found" \]\]; then default=1\s+elif \[\[ "\$reason" == "credential_mismatch" \]\]; then default=2\s+else default=4; fi/)
    expect(body).toContain("env_from_container")
    expect(body).toContain("env_backups")
    // The erase option only switches mode; confirm_erase still demands the phrase.
    expect(body).toContain("3) MODE=fresh; return 0 ;;")
  })

  it("re-keying feeds the password on stdin and accepts only URL-safe passwords", () => {
    const body = fn("rekey_database")
    expect(body).toContain("^[A-Za-z0-9]+$")
    expect(body).toMatch(/printf "ALTER ROLE arciin WITH PASSWORD '%s';\\n" "\$password" \\\n\s+\| dc exec -T postgres psql/)
  })

  it(".env is backed up beside the install and on the data disk", () => {
    const body = fn("save_env_backup")
    expect(body).toContain('"$ARCIIN_DIR/backups/env/')
    expect(body).toContain('"$DATA_DIR/backups/install/latest.env"')
    expect(body).toContain("install -m 600")
  })
})

describe("never destructive by default", () => {
  it("--fresh and --delete-data need ERASE ARCIIN; --delete-storage needs DELETE FILES", () => {
    expect(fn("confirm_erase")).toContain('arciin_confirm_typed "ERASE ARCIIN"')
    expect(fn("confirm_erase")).toContain("arciin.com/account")
    const uninstall = fn("do_uninstall")
    expect(uninstall).toContain('arciin_confirm_typed "DELETE FILES"')
    expect(uninstall.indexOf("confirm_erase")).toBeLessThan(uninstall.indexOf("dc down -v"))
    expect(uninstall).toMatch(/dc down --remove-orphans\n\s+ok "Containers removed — database volume, files/)
  })

  it("the database is dumped before an upgrade and before an erase", () => {
    expect(fn("pre_repair_backup")).toContain("pg_dump -U arciin -Fc arciin")
    const main = installer.slice(installer.indexOf("# ── Main"))
    expect(main.indexOf("pre_repair_backup")).toBeLessThan(main.indexOf("dc down -v"))
    expect(main).toMatch(/if \[\[ "\$MODE" != "fresh" \]\] && volume_exists; then\n\s+step "Backing up before the upgrade"\n\s+pre_repair_backup/)
  })

  it("an existing .env decides the data folder and port, not the defaults", () => {
    const main = installer.slice(installer.indexOf("# ── Main"))
    expect(main).toContain('DATA_DIR="$(env_get ARCIIN_HOST_DATA_DIR)"')
    expect(main).toContain('DATA_DIR="${DATA_DIR:-${CLI_DATA_DIR:-/srv/arciin-storage/arciin}}"')
  })

  it("storage refuses an unmounted disk and is write-tested as the containers' uid", () => {
    const body = fn("prepare_storage")
    expect(body).toContain("arciin_storage_mount_missing")
    expect(body).toContain('arciin_storage_write_test "$DATA_DIR" "$as"')
  })
})

describe("reboot survival is verified, not assumed", () => {
  it("Docker is enabled at boot and every container's restart policy is checked", () => {
    expect(fn("ensure_docker")).toContain("systemctl enable docker.service")
    expect(fn("verify_restart_policies")).toContain("{{.HostConfig.RestartPolicy.Name}}")
  })

  it("the installer waits for every service to be healthy, and names a credential failure as one", () => {
    const body = fn("wait_healthy")
    expect(body).toContain('$3 != "healthy"')
    expect(body).toContain("The API cannot log in to PostgreSQL.")
  })

  it("never touches the host firewall (Docker publishes ports itself; enabling ufw can lock out SSH)", () => {
    expect(installer).not.toContain("arciin_open_firewall_ports")
    expect(installer).not.toMatch(/ufw (--force )?enable/)
  })

  it("a port in use is reported with its owner", () => {
    const body = fn("preflight_port")
    expect(body).toContain("ss -lntH")
    expect(body).toContain("It is held by")
  })
})

describe("release manifest", () => {
  it("pins every image by tag and digest and checksums every asset", () => {
    const m = sampleManifest()
    expect(m.image_api).toBe(`ghcr.io/roberadesissaii-arc/arciin-api:1.1.4@${digest("2")}`)
    for (const name of MANIFEST_ASSETS) expect(m[assetKey(name)]).toMatch(/^[0-9a-f]{64}$/)
    expect(m.assets_base.endsWith("/")).toBe(true)
  })

  it("refuses a missing digest or a short SHA", () => {
    expect(() =>
      buildManifest({ ...sampleManifestInput(), digests: { web: digest("1"), api: "latest", worker: digest("3") } }),
    ).toThrow(/digest for api/)
    expect(() => buildManifest({ ...sampleManifestInput(), releaseSha: "abc123" })).toThrow(/releaseSha/)
  })

  it("the shell parsers in both installers read every field back", () => {
    const file = path.join(scratch, "stable.json")
    const m = sampleManifest()
    writeFileSync(file, serializeManifest(m))
    JSON.parse(readFileSync(file, "utf8"))
    const parser = installer.match(/^manifest_get\(\) \{ (.*); \}$/m)?.[1]
    expect(parser).toBeTruthy()
    for (const key of ["schema", "version", "image_web", "image_api", "image_worker", "assets_base", assetKey("Caddyfile"), assetKey("docker-compose.yml")]) {
      const out = execFileSync("bash", ["-c", `MANIFEST="$1"; manifest_get() { ${parser}; }; manifest_get "$2"`, "_", file, key], { encoding: "utf8" }).trim()
      expect(out, key).toBe(String(m[key as keyof typeof m]))
    }
    // The bootstrapper's parser is the same expression.
    const boot = read("scripts/install-bootstrap.sh").match(/^get\(\) \{ sed -n "(.*)" "\$work\/stable\.json" \| head -1; \}$/m)?.[1]
    expect(parser).toContain(boot!)
  })
})

function sampleManifestInput() {
  return {
    version: "1.1.4",
    releaseSha: "a".repeat(40),
    registry: "ghcr.io/roberadesissaii-arc",
    digests: { web: digest("1"), api: digest("2"), worker: digest("3") },
    assetHashes: Object.fromEntries(MANIFEST_ASSETS.map((n, i) => [n, String(i).repeat(64)])),
    assetsBase: "https://example.invalid/",
    publishedAt: "2026-10-05T00:00:00Z",
  }
}
