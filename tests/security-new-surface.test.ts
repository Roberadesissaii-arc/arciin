import { describe, expect, it } from "vitest"

/**
 * The surface this session added: two image endpoints and a file read that ends
 * up at a third party. These pin the checks that stop it being a way out of the
 * instance.
 */

describe("illustration ids cannot escape their directory", () => {
  // The id is joined onto a storage path, so anything but plain hex is a way to
  // read files elsewhere on the disk.
  const VALID = /^[a-f0-9]{32}$/

  it.each([
    "081ccceddfab1fd313514d3d772e9755",
    "00000000000000000000000000000000",
  ])("accepts a real id: %s", (id) => {
    expect(VALID.test(id)).toBe(true)
  })

  it.each([
    "../../../../etc/passwd",
    "..%2f..%2fetc%2fpasswd",
    "081ccced/../../../secret",
    "081ccceddfab1fd313514d3d772e9755.webp",
    "081CCCEDDFAB1FD313514D3D772E9755",
    "",
    "081ccced",
    "081ccceddfab1fd313514d3d772e9755aa",
  ])("refuses %j", (id) => {
    expect(VALID.test(id)).toBe(false)
  })
})

describe("only public https image URLs are followed", () => {
  // The image service returns a URL the server then fetches — remote input
  // driving a server-side request. Left open it reaches the metadata service.
  function isSafeImageUrl(raw: string): boolean {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return false
    }
    if (url.protocol !== "https:") return false
    const host = url.hostname.toLowerCase()
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false
    if (/^\[?(::1|fe80:|fc00:|fd)/i.test(host)) return false
    const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
    if (v4) {
      const [a, b] = [Number(v4[1]), Number(v4[2])]
      if (a === 127 || a === 10 || a === 0 || a === 169) return false
      if (a === 192 && b === 168) return false
      if (a === 172 && b >= 16 && b <= 31) return false
    }
    return true
  }

  it("follows a normal image host", () => {
    expect(isSafeImageUrl("https://imgs.x.ai/abc123.jpg")).toBe(true)
  })

  it.each([
    ["cloud metadata", "https://169.254.169.254/latest/meta-data/"],
    ["loopback", "https://127.0.0.1/admin"],
    ["loopback by name", "https://localhost/admin"],
    ["private class A", "https://10.0.0.5/x.jpg"],
    ["private class B", "https://172.16.4.53/x.jpg"],
    ["private class C", "https://192.168.4.53/x.jpg"],
    ["ipv6 loopback", "https://[::1]/x.jpg"],
    ["cluster-internal name", "https://api.internal/x.jpg"],
    ["plain http", "http://imgs.x.ai/abc123.jpg"],
    ["file scheme", "file:///etc/passwd"],
    ["not a url", "javascript:alert(1)"],
  ])("refuses %s", (_label, url) => {
    expect(isSafeImageUrl(url)).toBe(false)
  })

  it("refuses this instance's own LAN address", () => {
    // The address this server is reached on — the most obvious thing to point
    // a server-side fetch back at.
    expect(isSafeImageUrl("https://192.168.4.53:4000/api/settings")).toBe(false)
  })
})
