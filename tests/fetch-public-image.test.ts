import { describe, expect, it } from "vitest"

import { isPublicAddress } from "../apps/api/src/services/media/fetch-public-image"

/**
 * The address check that runs inside the resolver.
 *
 * Checking a hostname before connecting is not enough: a name that answers with
 * a public address now can answer with 127.0.0.1 on the next lookup, and the
 * connection follows DNS at the moment it is made. This is the check that runs
 * on the addresses actually being connected to.
 */

describe("public addresses are allowed", () => {
  it.each(["8.8.8.8", "1.1.1.1", "104.18.32.7", "2606:4700:4700::1111", "93.184.216.34"])(
    "%s",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true)
    },
  )
})

describe("addresses that reach inward are refused", () => {
  it.each([
    ["cloud metadata", "169.254.169.254"],
    ["loopback", "127.0.0.1"],
    ["loopback, other octet", "127.9.9.9"],
    ["this network", "0.0.0.0"],
    ["private class A", "10.1.2.3"],
    ["private class B low", "172.16.0.1"],
    ["private class B high", "172.31.255.254"],
    ["private class C", "192.168.4.53"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["multicast", "224.0.0.1"],
    ["reserved", "255.255.255.255"],
    ["ipv6 loopback", "::1"],
    ["ipv6 unspecified", "::"],
    ["ipv6 link-local", "fe80::1"],
    ["ipv6 unique-local", "fd00::1"],
  ])("%s", (_label, ip) => {
    expect(isPublicAddress(ip)).toBe(false)
  })

  it("sees through a v4-mapped IPv6 address", () => {
    // ::ffff:127.0.0.1 is loopback in different notation, and judging it as
    // "an IPv6 address, therefore fine" is how this check gets bypassed.
    expect(isPublicAddress("::ffff:127.0.0.1")).toBe(false)
    expect(isPublicAddress("::ffff:169.254.169.254")).toBe(false)
    expect(isPublicAddress("::ffff:192.168.4.53")).toBe(false)
  })

  it("still allows a v4-mapped public address", () => {
    expect(isPublicAddress("::ffff:8.8.8.8")).toBe(true)
  })

  it("refuses this instance's own address", () => {
    expect(isPublicAddress("192.168.4.53")).toBe(false)
  })
})

describe("malformed input is refused rather than assumed public", () => {
  it.each(["", "   ", "not-an-ip", "999.1.1.1", "1.2.3", "1.2.3.4.5", "-1.0.0.1"])(
    "%j",
    (value) => {
      expect(isPublicAddress(value)).toBe(false)
    },
  )
})
