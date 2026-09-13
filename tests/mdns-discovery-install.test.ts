import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "..")

function read(rel: string) {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

function bash(script: string, env: NodeJS.ProcessEnv = {}) {
  return execFileSync("bash", ["-lc", script], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  })
}

describe("persistent mDNS installer contract", () => {
  it("keeps a shared helper used by native and Docker installers", () => {
    expect(read("scripts/lib/avahi-discovery.sh")).toContain("arciin_setup_persistent_mdns")
    expect(read("install.sh")).toContain("scripts/lib/avahi-discovery.sh")
    expect(read("install.sh")).toContain("arciin_setup_persistent_mdns")
    expect(read("scripts/docker-setup.sh")).toContain("scripts/lib/avahi-discovery.sh")
    expect(read("scripts/docker-setup.sh")).toContain("arciin_setup_persistent_mdns")
    expect(read("scripts/advertise-arciin-mdns.sh")).toContain("arciin_setup_persistent_mdns")
  })

  it("does not advertise the API listen port", () => {
    const lib = read("scripts/lib/avahi-discovery.sh")
    expect(lib).toContain("4000")
    expect(lib).toContain("arciin_mdns_sanitize_port")
    const xml = bash(
      'source scripts/lib/avahi-discovery.sh; arciin_mdns_sanitize_port 3002; echo; arciin_mdns_sanitize_port 4000 || echo refused',
    )
    expect(xml).toMatch(/3002/)
    expect(xml).toMatch(/refused/)
  })

  it("writes only protocol and path TXT records", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "arciin-mdns-"))
    const dest = path.join(dir, "arciin.service")
    try {
      bash("source scripts/lib/avahi-discovery.sh; arciin_setup_persistent_mdns 3002", {
        ARCIIN_MDNS_DRY_RUN: "1",
        ARCIIN_AVAHI_SERVICE_PATH: dest,
      })
      const xml = readFileSync(dest, "utf8")
      expect(xml).toContain("<type>_arciin._tcp</type>")
      expect(xml).toContain("<port>3002</port>")
      expect(xml).toContain("<txt-record>protocol=1</txt-record>")
      expect(xml).toContain("<txt-record>path=/.well-known/arciin</txt-record>")
      expect(xml).not.toMatch(/email|password|storageRoot|license|DATABASE|REDIS|setupToken|SESSION/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("docker installer advertises HTTP port, native installer advertises web port", () => {
    const docker = read("scripts/docker-setup.sh")
    const native = read("install.sh")
    expect(docker).toMatch(/arciin_setup_persistent_mdns "\$http_port"/)
    expect(native).toMatch(/arciin_setup_persistent_mdns "\$\{ARCIIN_WEB_PORT\}"/)
    expect(docker).not.toMatch(/arciin_setup_persistent_mdns "4000"/)
    expect(native).not.toMatch(/arciin_setup_persistent_mdns "\$\{ARCIIN_API_PORT\}"/)
  })
})
