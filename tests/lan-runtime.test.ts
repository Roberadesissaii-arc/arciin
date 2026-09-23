import os from "node:os"

import { describe, expect, it } from "vitest"

import {
  buildAdvertisedLocalAccessUrls,
  selectLanIpv4Addresses,
  snapshotOsNetworkInterfaces,
} from "@arciin/config"

describe("LAN selection on this host (ARC-015)", () => {
  it("does not advertise Docker default-bridge or loopback as LAN", () => {
    const interfaces = snapshotOsNetworkInterfaces(() => os.networkInterfaces())
    const result = selectLanIpv4Addresses({
      interfaces,
      inContainer: false,
    })

    for (const address of result.selected) {
      expect(address.startsWith("127.")).toBe(false)
      expect(address.startsWith("169.254.")).toBe(false)
      expect(address.startsWith("172.17.")).toBe(false)
    }
    expect(result.rejected.some((row) => row.reason === "docker-default-bridge" || row.reason === "docker-or-bridge-interface" || row.reason === "loopback" || row.reason === "internal")).toBe(
      true,
    )
  })
})

describe("a configured LAN address that has gone stale (ARC-015)", () => {
  /**
   * ARCIIN_PUBLIC_URL named 192.168.4.46 while the machine actually held
   * 192.168.4.21. The override was pushed to the front of the list whether or
   * not any interface answered to it, so it became `primary` and was published
   * as the server's current address — in /.well-known/arciin and in Remote
   * Access — pointing at an address that answers nothing.
   */
  const interfaces = [
    { name: "enx0", address: "192.168.4.21", family: "IPv4" as const, internal: false },
    { name: "lo", address: "127.0.0.1", family: "IPv4" as const, internal: true },
  ]

  it("prefers the address the machine actually holds", () => {
    const result = selectLanIpv4Addresses({
      interfaces,
      inContainer: false,
      advertisedLanHost: "192.168.4.46",
    })
    expect(result.primary).toBe("192.168.4.21")
    expect(result.selected).not.toContain("192.168.4.46")
  })

  it("says why the configured value was dropped", () => {
    const result = selectLanIpv4Addresses({
      interfaces,
      inContainer: false,
      advertisedLanHost: "192.168.4.46",
    })
    expect(result.rejected).toContainEqual(
      expect.objectContaining({
        address: "192.168.4.46",
        reason: "override-not-on-any-interface",
      }),
    )
  })

  it("still honours an override the machine does hold", () => {
    // A machine with two LAN addresses can legitimately be told which to
    // advertise; that is what the override is for.
    const twoNics = [
      ...interfaces,
      { name: "eth1", address: "192.168.4.99", family: "IPv4" as const, internal: false },
    ]
    const result = selectLanIpv4Addresses({
      interfaces: twoNics,
      inContainer: false,
      advertisedLanHost: "192.168.4.99",
    })
    expect(result.primary).toBe("192.168.4.99")
  })

  it("keeps trusting the override inside a container", () => {
    // The host's LAN address is not on any interface the container can see, so
    // "not found locally" carries no information there.
    const result = selectLanIpv4Addresses({
      interfaces: [{ name: "eth0", address: "10.1.2.3", family: "IPv4" as const, internal: false }],
      inContainer: true,
      advertisedLanHost: "192.168.4.46",
    })
    expect(result.primary).toBe("192.168.4.46")
  })

  it("falls back to the real address when nothing is configured", () => {
    const result = selectLanIpv4Addresses({ interfaces, inContainer: false })
    expect(result.primary).toBe("192.168.4.21")
  })
})

describe("a preference orders the addresses; it cannot invent one (ARC-015)", () => {
  // selectLanIpv4Addresses dropping the stale override was not enough on its
  // own: buildAdvertisedLocalAccessUrls re-added preferredHost unconditionally
  // and sorted it first, putting the rejected address back at the front.
  const lanHosts = ["192.168.4.21"]

  it("ignores a preference for an address that did not survive selection", () => {
    const urls = buildAdvertisedLocalAccessUrls({
      lanHosts,
      preferredHost: "192.168.4.46",
      port: "3002",
    })
    expect(urls.primaryLanUrl).toBe("http://192.168.4.21:3002")
    expect(urls.lanUrls).toEqual(["http://192.168.4.21:3002"])
  })

  it("honours a preference among addresses that did survive", () => {
    const urls = buildAdvertisedLocalAccessUrls({
      lanHosts: ["192.168.4.21", "192.168.4.99"],
      preferredHost: "192.168.4.99",
      port: "3002",
    })
    expect(urls.primaryLanUrl).toBe("http://192.168.4.99:3002")
  })

  it("falls back to loopback rather than advertising an address that answers nothing", () => {
    const urls = buildAdvertisedLocalAccessUrls({
      lanHosts: [],
      preferredHost: "192.168.4.46",
      port: "3002",
    })
    expect(urls.primaryLanUrl).toBeNull()
    expect(urls.localUrl).toBe("http://127.0.0.1:3002")
  })
})
