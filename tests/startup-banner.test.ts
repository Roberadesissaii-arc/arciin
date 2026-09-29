import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { selectLanIpv4Addresses } from "@arciin/config"

import { startupBannerLines } from "../apps/api/src/services/remote-access/startup-banner"

/**
 * The startup banner advertises what the rest of Arciin advertises.
 *
 * It used to print every non-internal IPv4 address (Docker bridges included)
 * and ARCIIN_PUBLIC_URL verbatim, so after a DHCP move it announced
 * http://192.168.4.53:3002 while discovery, Settings → Domain and mobile
 * pairing already said 192.168.4.21. Interfaces here are injected — nothing
 * depends on this machine's real network.
 */

const HOST = [
  { name: "enx000ec6b347e0", address: "192.168.4.21", family: "IPv4" as const, internal: false },
  { name: "docker0", address: "172.17.0.1", family: "IPv4" as const, internal: false },
  { name: "br-8fc223207793", address: "172.19.0.1", family: "IPv4" as const, internal: false },
  { name: "lo", address: "127.0.0.1", family: "IPv4" as const, internal: true },
]

function lanHosts(advertisedLanHost: string | null, interfaces = HOST) {
  return selectLanIpv4Addresses({ interfaces, inContainer: false, advertisedLanHost }).selected
}

describe("startup banner", () => {
  it("lists only the LAN the resolver selects — no loopback, no container bridges", () => {
    const { info } = startupBannerLines({ appVersion: "1.1.0", apiPort: 4000, lanHosts: lanHosts(null), publicUrl: "http://192.168.4.21:3002" })
    const network = info.filter((l) => l.includes("Network:"))
    expect(network).toEqual(["  Network:  http://192.168.4.21:4000"])
    expect(info.join("\n")).not.toMatch(/172\.(17|19)\.0\.1|Network:  http:\/\/127\./)
  })

  it("a stale configured address is not repeated silently: the real one is named in a warning", () => {
    const hosts = lanHosts("192.168.4.53")
    expect(hosts).toEqual(["192.168.4.21"])
    const { warnings } = startupBannerLines({ appVersion: "1.1.0", apiPort: 4000, lanHosts: hosts, publicUrl: "http://192.168.4.53:3002" })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("192.168.4.53, which this machine does not hold (it is on 192.168.4.21)")
    expect(warnings[0]).toContain("ARCIIN_ADVERTISED_LAN")
  })

  it("no warning when the configured address is the one the machine holds", () => {
    const { warnings } = startupBannerLines({ appVersion: "1.1.0", apiPort: 4000, lanHosts: lanHosts("192.168.4.21"), publicUrl: "http://192.168.4.21:3002" })
    expect(warnings).toEqual([])
  })

  it("a public domain or tunnel is not treated as a LAN claim", () => {
    for (const publicUrl of ["https://files.example.com", "https://abc.trycloudflare.com", "http://localhost:3000"]) {
      expect(startupBannerLines({ appVersion: "1.1.0", apiPort: 4000, lanHosts: lanHosts(null), publicUrl }).warnings, publicUrl).toEqual([])
    }
  })

  it("no usable LAN still prints a banner, and says where the configured value went", () => {
    const loopbackOnly = [HOST[3]!]
    const { info, warnings } = startupBannerLines({ appVersion: "1.1.0", apiPort: 4000, lanHosts: lanHosts(null, loopbackOnly), publicUrl: "http://192.168.4.53:3002" })
    expect(info).toContain("  Local:    http://127.0.0.1:4000")
    expect(info.some((l) => l.includes("Network:"))).toBe(false)
    expect(warnings[0]).toContain("does not hold.")
  })

  it("the API entrypoint builds its banner from the canonical resolver, not raw interfaces", () => {
    const entry = readFileSync("apps/api/src/index.ts", "utf8")
    expect(entry).toContain("getLanIpv4Addresses()")
    expect(entry).toContain("startupBannerLines(")
    expect(entry).not.toContain("os.networkInterfaces")
  })
})
