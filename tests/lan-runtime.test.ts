import os from "node:os"

import { describe, expect, it } from "vitest"

import { selectLanIpv4Addresses, snapshotOsNetworkInterfaces } from "@arciin/config"

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
