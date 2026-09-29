import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  applyLicenseServerEnv,
  LICENSE_SERVER_ENV_KEYS as TS_LICENSE_KEYS,
  loadLicenseServerEnvFile,
} from "../apps/license-server/src/env-files"

/**
 * The license server and account portal get only what they read.
 *
 * ecosystem.vendor.config.cjs spread the whole Arciin .env into both, and the
 * license server's config.ts loaded the repo-root .env wholesale. Neither uses
 * Postgres, yet DATABASE_URL (and every session and vault secret) sat in both
 * processes — which is how the retired Postgres password outlived its
 * rotation in their PM2 state.
 */

const require = createRequire(import.meta.url)
const REPO = path.resolve(__dirname, "..")
const { LICENSE_SERVER_ENV_KEYS, ACCOUNT_ENV_KEYS, buildVendorEnvs } = require("../scripts/lib/vendor-env.cjs") as {
  LICENSE_SERVER_ENV_KEYS: readonly string[]
  ACCOUNT_ENV_KEYS: readonly string[]
  buildVendorEnvs: (dotenv: Record<string, string>) => { licenseServer: Record<string, string>; account: Record<string, string> }
}

/** A production-shaped .env: everything the API needs, plus both vendor services' keys. */
const ARCIIN_DOTENV: Record<string, string> = {
  DATABASE_URL: "postgresql://arciin:not-for-vendors@localhost:5432/arciin",
  REDIS_URL: "redis://127.0.0.1:6379/0",
  SESSION_SECRET: "session-secret",
  VAULT_ENCRYPTION_KEY: "vault-key",
  ARCIIN_SETUP_TOKEN: "setup-token",
  API_PORT: "4000",
  NODE_ENV: "development",
  LOG_LEVEL: "warn",
  LICENSE_SERVER_HOST: "127.0.0.1",
  LICENSE_SERVER_PORT: "4100",
  LICENSE_DATABASE_URL: "file:/srv/license/licenses.db",
  LICENSE_SIGNING_KEY: "signing-key",
  LICENSE_SIGNING_KID: "kid-1",
  LICENSE_SERVICE_TOKENS: "svc-a,svc-b",
  LICENSE_ADMIN_TOKENS: "adm-a",
  LICENSE_LEGACY_HMAC_SECRET: "legacy",
  LICENSE_RATE_LIMIT_PER_MINUTE: "60",
  LICENSE_SERVER_URL: "http://127.0.0.1:4100",
  LICENSE_SERVICE_TOKEN: "svc-a",
  LICENSE_ADMIN_TOKEN: "adm-a",
  ARCIIN_PUBLIC_URL: "http://192.168.4.21:3002",
  ARCIIN_ACCOUNT_ORIGINS: "http://192.168.4.21:3010",
  NEXT_PUBLIC_ARCIIN_ACCOUNT_URL: "http://127.0.0.1:3010",
}

const NEVER_FOR_VENDORS = ["DATABASE_URL", "REDIS_URL", "SESSION_SECRET", "VAULT_ENCRYPTION_KEY", "ARCIIN_SETUP_TOKEN", "API_PORT"]

describe("PM2 environments for the vendor services", () => {
  const envs = buildVendorEnvs(ARCIIN_DOTENV)

  it("the license server gets no DATABASE_URL and none of the API's secrets", () => {
    for (const key of NEVER_FOR_VENDORS) expect(envs.licenseServer, key).not.toHaveProperty(key)
  })

  it("the account portal gets no DATABASE_URL and none of the API's secrets", () => {
    for (const key of NEVER_FOR_VENDORS) expect(envs.account, key).not.toHaveProperty(key)
  })

  it("every LICENSE_* value the license server reads arrives unchanged", () => {
    for (const key of LICENSE_SERVER_ENV_KEYS.filter((k) => k.startsWith("LICENSE_"))) {
      expect(envs.licenseServer[key], key).toBe(ARCIIN_DOTENV[key])
    }
    expect(envs.licenseServer.LOG_LEVEL).toBe("warn")
  })

  it("the account portal gets every variable it reads", () => {
    for (const key of ACCOUNT_ENV_KEYS.filter((k) => k !== "NODE_ENV")) {
      expect(envs.account[key], key).toBe(ARCIIN_DOTENV[key])
    }
  })

  it("nothing outside the allowlists gets through; both still run as production", () => {
    expect(Object.keys(envs.licenseServer).sort()).toEqual([...new Set([...LICENSE_SERVER_ENV_KEYS, "ARCIIN_ENV_NAMESPACE"])].sort())
    expect(Object.keys(envs.account).sort()).toEqual([...new Set([...ACCOUNT_ENV_KEYS, "ARCIIN_ENV_NAMESPACE"])].sort())
    for (const env of [envs.licenseServer, envs.account]) {
      expect(env.NODE_ENV).toBe("production")
      expect(env.ARCIIN_ENV_NAMESPACE).toBe("production")
    }
  })

  it("the vendor ecosystem uses the allowlists and no broad spread", () => {
    const source = readFileSync(path.join(REPO, "ecosystem.vendor.config.cjs"), "utf8")
    expect(source).toContain('require("./scripts/lib/vendor-env.cjs")')
    expect(source).toContain("env: vendorEnv.licenseServer")
    expect(source).toContain("env: vendorEnv.account")
    expect(source).not.toMatch(/\.\.\.\s*(dotenv|process\.env)\b/)
    expect(source).not.toContain("sharedEnv")
  })

  it("the self-hosted API and worker keep the full .env they need", () => {
    const main = readFileSync(path.join(REPO, "ecosystem.config.cjs"), "utf8")
    expect(main).toMatch(/const sharedEnv = \{\s*\.\.\.dotenv,/)
    for (const app of ["arciin-api", "arciin-worker", "arciin-web"]) expect(main).toContain(`name: "${app}"`)
  })
})

describe("the license server's own .env loading", () => {
  const tmp: string[] = []
  afterEach(() => {
    for (const dir of tmp.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it("takes only its own keys from the repo-root .env", () => {
    const target: NodeJS.ProcessEnv = {}
    const applied = applyLicenseServerEnv(ARCIIN_DOTENV, target)
    expect(target).not.toHaveProperty("DATABASE_URL")
    for (const key of NEVER_FOR_VENDORS) expect(target, key).not.toHaveProperty(key)
    expect(target.LICENSE_SIGNING_KEY).toBe("signing-key")
    expect(target.LICENSE_DATABASE_URL).toBe("file:/srv/license/licenses.db")
    expect(applied).toContain("LICENSE_SERVICE_TOKENS")
  })

  it("never overrides a value the environment already set (PM2 wins over the file)", () => {
    const target: NodeJS.ProcessEnv = { LICENSE_SIGNING_KID: "from-pm2" }
    applyLicenseServerEnv(ARCIIN_DOTENV, target)
    expect(target.LICENSE_SIGNING_KID).toBe("from-pm2")
  })

  it("reads a real file, and a missing file is not an error", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arciin-lic-env-"))
    tmp.push(dir)
    const file = path.join(dir, ".env")
    writeFileSync(file, Object.entries(ARCIIN_DOTENV).map(([k, v]) => `${k}=${v}`).join("\n"))
    const target: NodeJS.ProcessEnv = {}
    loadLicenseServerEnvFile(file, target)
    expect(target).not.toHaveProperty("DATABASE_URL")
    expect(target.LICENSE_ADMIN_TOKENS).toBe("adm-a")
    expect(loadLicenseServerEnvFile(path.join(dir, "absent.env"), {})).toEqual([])
  })

  it("config.ts loads the repo-root .env only through the allowlist", () => {
    const config = readFileSync(path.join(REPO, "apps/license-server/src/config.ts"), "utf8")
    expect(config).toContain('loadLicenseServerEnvFile(path.join(repoRoot, ".env"))')
    expect(config).not.toMatch(/loadEnv\(\{\s*path:\s*path\.join\(repoRoot/)
  })

  it("the TypeScript and PM2 allowlists name the same keys", () => {
    expect([...TS_LICENSE_KEYS].sort()).toEqual([...LICENSE_SERVER_ENV_KEYS].sort())
  })

  it("the allowlist covers every key the license server's config schema reads", () => {
    const config = readFileSync(path.join(REPO, "apps/license-server/src/config.ts"), "utf8")
    const schema = config.slice(config.indexOf("const schema = z.object({"), config.indexOf("})", config.indexOf("const schema = z.object({")))
    const schemaKeys = [...schema.matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]!)
    expect(schemaKeys.length).toBeGreaterThan(5)
    for (const key of schemaKeys) expect(TS_LICENSE_KEYS, key).toContain(key)
  })
})
