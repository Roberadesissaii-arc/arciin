import { readFileSync } from "node:fs"
import path from "node:path"
import vm from "node:vm"

import { describe, expect, it } from "vitest"

/**
 * ecosystem.config.cjs is shared by the vendor host and every customer's
 * native install. The licensing-authority tunnel (cloudflared with the
 * vendor's tunnel config) used to be in it unconditionally, so customer
 * servers started it and it crash-looped. It is included only where its
 * config exists.
 */
const ROOT = path.resolve(import.meta.dirname, "..")
const source = readFileSync(path.join(ROOT, "ecosystem.config.cjs"), "utf8")

function appsWhen(tunnelConfigExists: boolean): string[] {
  const realFs = require("node:fs")
  const fakeFs = {
    ...realFs,
    existsSync: (p: string) => (p.endsWith("/.cloudflared/config.yml") ? tunnelConfigExists : realFs.existsSync(p)),
  }
  const module = { exports: {} as { apps: { name: string }[] } }
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    __dirname: ROOT,
    process,
    require: (id: string) => (id === "node:fs" || id === "fs" ? fakeFs : require(id)),
  })
  return module.exports.apps.map((a) => a.name)
}

describe("PM2 ecosystem", () => {
  it("a customer install runs exactly web, api and worker", () => {
    expect(appsWhen(false)).toEqual(["arciin-web", "arciin-api", "arciin-worker"])
  })

  it("the vendor host (tunnel config present) still runs the licence tunnel", () => {
    expect(appsWhen(true)).toContain("arciin-license-tunnel")
  })
})
