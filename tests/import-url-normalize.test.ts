import { describe, expect, it } from "vitest"

import { normalizeImportUrl } from "@arciin/shared"

import { isImportablePublicUrl } from "../apps/api/src/services/imports/url-guard"

/**
 * Typed links become URLs the same way in the browser and the API — and a
 * normalised URL is only a candidate: the SSRF guard still decides.
 */

const ok = (input: string) => {
  const r = normalizeImportUrl(input)
  if (!r.ok) throw new Error(`expected ${input} to normalise: ${r.reason}`)
  return r.url
}
const refused = (input: string) => {
  const r = normalizeImportUrl(input)
  expect(r.ok, input).toBe(false)
  return r.ok ? "" : r.reason
}

describe("normalizeImportUrl", () => {
  it.each([
    ["google.com", "https://google.com/"],
    ["www.google.com", "https://www.google.com/"],
    ["youtube.com/watch?v=abc", "https://youtube.com/watch?v=abc"],
    ["example.com/path?q=hello", "https://example.com/path?q=hello"],
    ["www.example.com/path", "https://www.example.com/path"],
    ["  example.com/video  ", "https://example.com/video"],
    ["//cdn.example.com/a.png", "https://cdn.example.com/a.png"],
    ["example.com:8080/x", "https://example.com:8080/x"],
    ["[www.example.com/path](https://www.example.com/path)", "https://www.example.com/path"],
    ["<https://example.com/a>", "https://example.com/a"],
  ])("%s → %s", (input, expected) => {
    expect(ok(input)).toBe(expected)
  })

  it("leaves a full https link unchanged", () => {
    expect(ok("https://example.com/file.mp4")).toBe("https://example.com/file.mp4")
  })

  it("keeps http as http — it is not upgraded, and the guard still judges it", () => {
    expect(ok("http://192.168.1.10/file.mp4")).toBe("http://192.168.1.10/file.mp4")
    expect(isImportablePublicUrl(ok("http://192.168.1.10/file.mp4"))).toBe(false)
    expect(ok("http://example.com/a")).toBe("http://example.com/a")
  })

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    "data:text/html,<script>x</script>",
    "file:///etc/passwd",
    "ftp://files.example.com/a",
    "blob:https://example.com/uuid",
    "chrome://settings",
    "about:blank",
    "mailto:a@example.com",
    "foo:bar",
  ])("refuses the non-web scheme %s", (input) => {
    expect(refused(input)).toMatch(/web links/i)
  })

  it("refuses credentials in the link", () => {
    expect(refused("https://user:password@example.com/")).toMatch(/username or password/)
    expect(refused("user:password@example.com")).toBeTruthy()
  })

  it.each(["", "   ", "example", "exa mple.com", "-bad.com", "bad-.com", "a..b.com", "https://", "http://.com", "example.c0m"])(
    "refuses malformed input %j instead of prefixing https://",
    (input) => {
      refused(input)
    },
  )

  it("refuses absurdly long input", () => {
    refused(`example.com/${"a".repeat(3000)}`)
  })
})

describe("normalised links still meet the SSRF guard", () => {
  it.each([
    "localhost",
    "localhost:3000/admin",
    "127.0.0.1",
    "127.0.0.1:4000/api",
    "http://[::1]/",
    "10.0.0.5/file",
    "172.16.4.1",
    "192.168.1.10/file.mp4",
    "169.254.169.254/latest/meta-data",
    "http://[fe80::1]/",
    "metadata.google.internal/computeMetadata",
    "printer.local",
    "2130706433",
  ])("%s is refused after normalising", (input) => {
    const r = normalizeImportUrl(input)
    expect(r.ok ? isImportablePublicUrl(r.url) : false).toBe(false)
  })

  it("a public host passes", () => {
    expect(isImportablePublicUrl(ok("example.com/video"))).toBe(true)
  })
})
