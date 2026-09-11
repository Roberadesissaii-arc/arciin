import { describe, expect, it } from "vitest"

import {
  isDockerDefaultBridgeIpv4,
  isUsableLanOverrideHostname,
  selectLanIpv4Addresses,
  type LanInterfaceAddress,
} from "./lan-address"

function iface(
  name: string,
  address: string,
  extras: Partial<LanInterfaceAddress> = {},
): LanInterfaceAddress {
  return { name, address, family: "IPv4", internal: false, ...extras }
}

describe("LAN address selection (ARC-015)", () => {
  it("rejects loopback-only hosts", () => {
    const result = selectLanIpv4Addresses({
      interfaces: [iface("lo", "127.0.0.1", { internal: true })],
    })
    expect(result.selected).toEqual([])
    expect(result.primary).toBeNull()
    expect(result.rejected[0]?.reason).toMatch(/loopback|internal/)
  })

  it("prefers Ethernet over a Docker bridge", () => {
    const result = selectLanIpv4Addresses({
      interfaces: [
        iface("docker0", "172.17.0.1"),
        iface("enp3s0", "192.168.4.20"),
      ],
    })
    expect(result.primary).toBe("192.168.4.20")
    expect(result.selected).toEqual(["192.168.4.20"])
    expect(result.rejected.some((row) => row.reason === "docker-or-bridge-interface")).toBe(true)
  })

  it("prefers Wi-Fi over a Docker bridge", () => {
    const result = selectLanIpv4Addresses({
      interfaces: [iface("wlp2s0", "192.168.1.40"), iface("br-abc123", "172.18.0.1")],
    })
    expect(result.primary).toBe("192.168.1.40")
  })

  it("returns Ethernet then Wi-Fi deterministically", () => {
    const result = selectLanIpv4Addresses({
      interfaces: [iface("wlp2s0", "192.168.1.40"), iface("enp3s0", "192.168.1.10")],
    })
    expect(result.selected).toEqual(["192.168.1.10", "192.168.1.40"])
    expect(result.primary).toBe("192.168.1.10")
  })

  it("keeps multiple RFC1918 networks in a stable order", () => {
    const result = selectLanIpv4Addresses({
      interfaces: [iface("eth1", "10.0.0.8"), iface("eth0", "192.168.50.2")],
    })
    expect(result.selected).toEqual(["192.168.50.2", "10.0.0.8"])
  })

  it("deprioritizes a VPN when a physical LAN exists", () => {
    const result = selectLanIpv4Addresses({
      interfaces: [iface("wg0", "10.8.0.2"), iface("enp3s0", "192.168.4.20")],
    })
    expect(result.primary).toBe("192.168.4.20")
    expect(result.selected).toContain("10.8.0.2")
  })

  it("ignores IPv6 when selecting IPv4 LAN", () => {
    const result = selectLanIpv4Addresses({
      interfaces: [
        { name: "enp3s0", address: "fe80::1", family: "IPv6", internal: false },
        iface("enp3s0", "192.168.4.20"),
      ],
    })
    expect(result.selected).toEqual(["192.168.4.20"])
  })

  it("rejects every container interface", () => {
    const result = selectLanIpv4Addresses({
      inContainer: true,
      interfaces: [iface("eth0", "172.20.0.4")],
    })
    expect(result.selected).toEqual([])
    expect(result.rejected[0]?.reason).toBe("container-only-network")
  })

  it("returns no LAN when nothing usable exists", () => {
    const result = selectLanIpv4Addresses({
      interfaces: [iface("lo", "127.0.0.1", { internal: true }), iface("docker0", "172.17.0.1")],
    })
    expect(result.primary).toBeNull()
  })

  it("honours an explicit LAN override before interface order", () => {
    const result = selectLanIpv4Addresses({
      advertisedLanOverride: "10.1.2.3",
      interfaces: [iface("enp3s0", "192.168.4.20"), iface("eth1", "10.1.2.3")],
    })
    expect(result.primary).toBe("10.1.2.3")
  })

  it("does not treat a remote domain as a LAN override", () => {
    expect(isUsableLanOverrideHostname("files.example.com")).toBe(false)
    const result = selectLanIpv4Addresses({
      advertisedLanHost: "files.example.com",
      interfaces: [iface("enp3s0", "192.168.4.20")],
    })
    expect(result.primary).toBe("192.168.4.20")
  })

  it("never labels Docker's default bridge as LAN", () => {
    expect(isDockerDefaultBridgeIpv4("172.17.0.4")).toBe(true)
    expect(isUsableLanOverrideHostname("172.17.0.4")).toBe(false)
  })

  it("is stable regardless of interface insertion order", () => {
    const a = selectLanIpv4Addresses({
      interfaces: [iface("eth1", "10.0.0.2"), iface("eth0", "192.168.0.5")],
    })
    const b = selectLanIpv4Addresses({
      interfaces: [iface("eth0", "192.168.0.5"), iface("eth1", "10.0.0.2")],
    })
    expect(a.selected).toEqual(b.selected)
  })
})
