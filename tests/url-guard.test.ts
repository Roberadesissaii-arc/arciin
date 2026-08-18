import { describe, expect, it } from "vitest"

import {
  isBlockedAddress,
  isImportablePublicUrl,
  normalizeHostname,
} from "../apps/api/src/services/imports/url-guard"

/**
 * The import URL guard.
 *
 * The version this replaced checked strings, and its IPv6 rules never fired at
 * all: `new URL("http://[::1]/").hostname` is `"[::1]"` — brackets included —
 * so every comparison against `"::1"` was false. The cases below are written
 * against parsed addresses for that reason, and each numeric-encoding case is
 * here because it is a real bypass someone would try, not for completeness.
 */

describe("normalizeHostname", () => {
  it("strips the brackets WHATWG URL keeps around IPv6", () => {
    expect(normalizeHostname("[::1]")).toBe("::1")
    expect(normalizeHostname("[::ffff:7f00:1]")).toBe("::ffff:7f00:1")
  })

  it("drops a trailing root dot and lowercases", () => {
    expect(normalizeHostname("Example.COM.")).toBe("example.com")
  })
})

describe("isBlockedAddress", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["10.1.2.3", "RFC1918 /8"],
    ["172.16.0.1", "RFC1918 /12 lower bound"],
    ["172.31.255.254", "RFC1918 /12 upper bound"],
    ["192.168.1.1", "RFC1918 /16"],
    ["169.254.169.254", "link-local / cloud metadata"],
    ["100.64.0.1", "CGNAT"],
    ["0.0.0.0", "this network"],
    ["198.18.0.1", "benchmarking"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "broadcast"],
  ])("blocks %s (%s)", (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it.each([
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["93.184.216.34"],
    ["172.32.0.1"], // just outside the RFC1918 /12
    ["192.169.0.1"], // just outside 192.168/16
    ["100.128.0.1"], // just outside CGNAT
  ])("allows public address %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false)
  })

  it.each([
    ["::1", "IPv6 loopback"],
    ["::", "unspecified"],
    ["fe80::1", "link-local"],
    ["fc00::1", "unique-local"],
    ["fd12:3456::1", "unique-local"],
    ["ff02::1", "multicast"],
    ["::ffff:7f00:1", "IPv4-mapped loopback (normalized form)"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback (textual form)"],
    ["::ffff:c0a8:1", "IPv4-mapped 192.168.0.1"],
  ])("blocks %s (%s)", (address) => {
    expect(isBlockedAddress(address)).toBe(true)
  })

  it("allows a public IPv6 address", () => {
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false)
  })
})

describe("isImportablePublicUrl", () => {
  it("allows ordinary public links", () => {
    expect(isImportablePublicUrl("https://example.com/video.mp4")).toBe(true)
    expect(isImportablePublicUrl("https://www.youtube.com/watch?v=abc")).toBe(true)
    expect(isImportablePublicUrl("http://93.184.216.34/a.png")).toBe(true)
  })

  /**
   * Node's URL parser folds these into dotted-quad form before we ever see
   * them, which is why the numeric checks catch them — asserted rather than
   * assumed, because the whole guard rests on it.
   */
  it.each([
    ["http://2130706433/", "decimal 127.0.0.1"],
    ["http://0x7f000001/", "hex 127.0.0.1"],
    ["http://0177.0.0.1/", "octal 127.0.0.1"],
    ["http://127.1/", "short form 127.0.0.1"],
  ])("rejects %s (%s)", (url) => {
    expect(isImportablePublicUrl(url)).toBe(false)
  })

  it.each([
    ["http://[::1]/", "IPv6 loopback"],
    ["http://[::ffff:127.0.0.1]/", "IPv4-mapped loopback"],
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata"],
    ["http://localhost:3000/", "localhost"],
    ["http://arciin.localhost/", ".localhost suffix"],
    ["http://nas.local/", ".local suffix"],
    ["http://db.internal/", ".internal suffix"],
    ["http://metadata.google.internal/", "GCP metadata"],
    ["http://192.168.4.53:4000/api/assets", "the instance's own LAN address"],
  ])("rejects %s (%s)", (url) => {
    expect(isImportablePublicUrl(url)).toBe(false)
  })

  it.each([
    ["file:///etc/passwd", "file scheme"],
    ["ftp://example.com/x", "ftp scheme"],
    ["gopher://example.com/", "gopher scheme"],
    ["javascript:alert(1)", "javascript scheme"],
    ["not a url", "unparseable"],
    ["", "empty"],
  ])("rejects %s (%s)", (url) => {
    expect(isImportablePublicUrl(url)).toBe(false)
  })

  it("ignores credentials in the authority when judging the host", () => {
    // http://user@127.0.0.1/ parses with hostname 127.0.0.1 — the userinfo must
    // not distract the check.
    expect(isImportablePublicUrl("http://user:pass@127.0.0.1/")).toBe(false)
  })
})
