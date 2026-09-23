import { describe, expect, it } from "vitest"

import { buildAdvertisedLocalAccessUrls, selectLanIpv4Addresses } from "@arciin/config"

/**
 * Settings → Domain presented four things that were not true at once: a LAN
 * address the machine had given up (192.168.4.53), the mobile port on every
 * row including "This machine", rows padded out to "LAN 1" and "LAN 2", and
 * "Live" next to a public URL that answered 404 from Cloudflare's edge.
 *
 * The address half is covered here. The status half is covered by the state
 * machine below, which is the part that decided what the pill said.
 */

const interfaces = [
  { name: "enx0", address: "192.168.4.21", family: "IPv4" as const, internal: false },
  { name: "lo", address: "127.0.0.1", family: "IPv4" as const, internal: true },
  { name: "docker0", address: "172.17.0.1", family: "IPv4" as const, internal: false },
]

const DESKTOP_PORT = "3002"
const MOBILE_PORT = "3003"

function resolve(port: string, configuredHost: string | null) {
  const selection = selectLanIpv4Addresses({
    interfaces,
    inContainer: false,
    advertisedLanHost: configuredHost,
  })
  return buildAdvertisedLocalAccessUrls({
    lanHosts: selection.selected,
    preferredHost: configuredHost,
    port,
  })
}

describe("the address an old config names is not offered as current", () => {
  it.each([
    ["ARCIIN_PUBLIC_URL", "192.168.4.53"],
    ["a PM2-held value", "192.168.4.46"],
    ["an older one still", "192.168.4.40"],
  ])("%s naming %s is ignored when no interface holds it", (_label, stale) => {
    const desktop = resolve(DESKTOP_PORT, stale)
    const mobile = resolve(MOBILE_PORT, stale)
    for (const url of [...desktop.lanUrls, ...mobile.lanUrls]) {
      expect(url).not.toContain(stale)
    }
    expect(desktop.primaryLanUrl).toBe("http://192.168.4.21:3002")
    expect(mobile.primaryLanUrl).toBe("http://192.168.4.21:3003")
  })

  it("offers the real address once, not padded into LAN 1 and LAN 2", () => {
    // Two rows appeared because the stale host was added alongside the real
    // one. With one interface there is one address to show.
    expect(resolve(DESKTOP_PORT, "192.168.4.53").lanUrls).toEqual([
      "http://192.168.4.21:3002",
    ])
  })

  it("never offers the docker bridge as a way in", () => {
    expect(resolve(DESKTOP_PORT, null).lanUrls.join()).not.toContain("172.17.")
  })
})

describe("each row carries the port of the app it reaches", () => {
  it("desktop rows use the desktop port", () => {
    const desktop = resolve(DESKTOP_PORT, null)
    expect(desktop.primaryLanUrl).toBe("http://192.168.4.21:3002")
    expect(desktop.loopbackUrl).toBe("http://127.0.0.1:3002")
  })

  it("mobile rows use the mobile port", () => {
    const mobile = resolve(MOBILE_PORT, null)
    expect(mobile.primaryLanUrl).toBe("http://192.168.4.21:3003")
    expect(mobile.loopbackUrl).toBe("http://127.0.0.1:3003")
  })

  it("the two are never the same address", () => {
    // The panel built every row from the mobile resolver, so "This machine"
    // and the LAN rows all claimed the mobile port while describing the server.
    expect(resolve(DESKTOP_PORT, null).primaryLanUrl).not.toBe(
      resolve(MOBILE_PORT, null).primaryLanUrl,
    )
  })
})

/**
 * The pill's rule, kept next to the addresses it sits beside. This mirrors the
 * derivation in domain-panel.tsx; the point being pinned is that a running
 * process on its own is never enough to say Live.
 */
function statusLabel(tunnel: {
  running: boolean
  stale?: boolean
  reachable?: boolean | null
}): string {
  if (!tunnel.running) return tunnel.stale ? "Expired" : "Off"
  if (tunnel.reachable === true) return "Live"
  if (tunnel.reachable === false) return "Unavailable"
  return "Starting"
}

describe("Live means the public URL answered", () => {
  it("a running process whose URL 404s is not Live", () => {
    // Exactly the observed state: cloudflared up, hostname registered, origin
    // healthy on 3002, and the edge returning 404 for the hostname.
    expect(statusLabel({ running: true, reachable: false })).toBe("Unavailable")
  })

  it("a reachable tunnel is Live", () => {
    expect(statusLabel({ running: true, reachable: true })).toBe("Live")
  })

  it("a tunnel that has not answered yet is Starting, not Live", () => {
    expect(statusLabel({ running: true, reachable: null })).toBe("Starting")
  })

  it("a stopped tunnel holding an old URL is Expired", () => {
    expect(statusLabel({ running: false, stale: true, reachable: false })).toBe("Expired")
  })

  it("no tunnel is Off", () => {
    expect(statusLabel({ running: false })).toBe("Off")
  })

  it.each([true, false, null] as const)(
    "reachable=%s never reads Live unless it is true",
    (reachable) => {
      const label = statusLabel({ running: true, reachable })
      if (reachable !== true) expect(label).not.toBe("Live")
    },
  )
})
