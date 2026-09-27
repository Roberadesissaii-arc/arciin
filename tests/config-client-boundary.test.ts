import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import * as clientConfig from "../packages/config/src/client"
import * as fullConfig from "../packages/config/src/index"

/**
 * Server configuration stays out of the browser, by construction.
 *
 * @arciin/shared used to `export * from "@arciin/config"`, and nearly every web
 * component imports @arciin/shared — so the server's env schema (with its
 * DATABASE_URL/REDIS_URL/SESSION_SECRET field names and default storage
 * path), namespace-isolation rules, and licence-signing code were all one
 * import away from every page. The bundle scan only pinned that at "no
 * worse". These assertions make the split structural:
 *
 * - the client entry exports no server-only module, directly or transitively;
 * - @arciin/shared re-exports only the client entry;
 * - no web file outside next.config.ts imports the full barrel.
 */

const ROOT = path.resolve(__dirname, "..")
const SERVER_ONLY_MODULES = [
  "env",
  "load-env",
  "environment",
  "license-signing",
  "license-token",
  "trusted-entitlement",
  "device-pairing",
]

/** Names that only a server-only module defines. */
const SERVER_ONLY_NAMES = [
  "coreEnvSchema",
  "loadArciinEnv",
  "assertEnvironmentIsolation",
  "PRODUCTION_RESOURCES",
  "signHostedLicenseToken",
  "parseLicensePrivateKey",
  "verifyHostedLicenseToken",
  "trustedLicenseSnapshotFromRow",
  "generateDevicePairingCode",
]

describe("@arciin/config/client", () => {
  it("exports none of the server-only names", () => {
    const leaked = SERVER_ONLY_NAMES.filter((name) => name in clientConfig)
    expect(leaked).toEqual([])
  })

  it("the full entry is exactly client plus server-only (nothing lost in the split)", () => {
    for (const name of Object.keys(clientConfig)) expect(name in fullConfig).toBe(true)
    for (const name of SERVER_ONLY_NAMES) expect(name in fullConfig, name).toBe(true)
  })

  it("imports no server-only module, directly or transitively", () => {
    const seen = new Set<string>()
    const visit = (mod: string) => {
      if (seen.has(mod)) return
      seen.add(mod)
      const text = readFileSync(path.join(ROOT, "packages/config/src", `${mod}.ts`), "utf8")
      for (const m of text.matchAll(/from "\.\/([a-z-]+)"/g)) visit(m[1]!)
    }
    visit("client")
    expect([...seen].filter((m) => SERVER_ONLY_MODULES.includes(m))).toEqual([])
    // And nothing reachable from the client entry touches node built-ins.
    for (const mod of seen) {
      const text = readFileSync(path.join(ROOT, "packages/config/src", `${mod}.ts`), "utf8")
      // integration-code-guide holds a sample *program* as a string for the
      // docs page; its node: imports are text shown to a reader, not code.
      const code = mod === "integration-code-guide" ? "" : text
      expect(/^import [^\n]*from "node:/m.test(code), `${mod} imports a node built-in`).toBe(false)
      expect(/process\.env/.test(code), `${mod} reads process.env`).toBe(false)
    }
  })
})

describe("who may import the full barrel", () => {
  it("@arciin/shared re-exports only the client entry", () => {
    const shared = readFileSync(path.join(ROOT, "packages/shared/src/index.ts"), "utf8")
    expect(shared).toContain('export * from "@arciin/config/client"')
    expect(shared).not.toMatch(/from "@arciin\/config"\s*$/m)
  })

  it("no web source imports the full barrel except next.config.ts", () => {
    const web = path.join(ROOT, "apps/web")
    const skip = new Set(["node_modules", ".next", ".next-dev", ".next-build", ".next-e2e", "public"])
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (skip.has(name)) continue
        const full = path.join(dir, name)
        if (statSync(full).isDirectory()) walk(full)
        else if (/\.(ts|tsx|mjs)$/.test(name)) {
          const rel = path.relative(web, full)
          if (rel === "next.config.ts") continue
          if (/from ["']@arciin\/config["']/.test(readFileSync(full, "utf8"))) offenders.push(rel)
        }
      }
    }
    walk(web)
    expect(offenders).toEqual([])
  })
})
