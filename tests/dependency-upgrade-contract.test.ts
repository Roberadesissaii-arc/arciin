import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * Two upgrades in this release changed behaviour underneath us, quietly.
 *
 * pdf.js 6 removed `PDFDocumentProxy.destroy()`. It is a runtime-only removal
 * on the server paths, which call it after reading a document — the type error
 * surfaced in the browser bundle, but the two server callers would have thrown
 * on every PDF had they not been fixed with it.
 *
 * Fastify 5.12 kept accepting a numeric `trustProxy` but redefined it to trust
 * *nothing*: hop counting cannot validate the immediate peer. An instance
 * configured with ARCIIN_TRUST_PROXY="1" would have kept booting while
 * request.ip silently became the proxy's address — wrong rate limits, wrong
 * audit trail, no error anywhere. We refuse the spelling instead.
 */

const root = path.resolve(__dirname, "..")
const read = (p: string) => readFileSync(path.join(root, p), "utf8")

describe("pdf.js 6 teardown", () => {
  const callers = [
    "apps/web/lib/files/pdfjs-client.ts",
    "packages/shared/src/pdf-metadata.ts",
    "apps/api/src/services/chat/read-pdf-asset.ts",
  ]

  it("has callers to check", () => {
    expect(callers.length).toBe(3)
  })

  it("never calls the removed PDFDocumentProxy.destroy()", () => {
    for (const file of callers) {
      const src = read(file)
      expect(src, `${file} must not call doc.destroy()`).not.toMatch(
        /\b(doc|pdf)\.destroy\(\)/,
      )
    }
  })

  it("tears down through the loading task instead", () => {
    for (const file of callers) {
      expect(read(file), `${file} must release the document`).toMatch(
        /loadingTask\.destroy\(\)/,
      )
    }
  })

  it("is pinned at or above the version that fixes the RCE advisory", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>
    }
    // GHSA-hq66-cqwq-w95j: arbitrary JS execution on opening a malicious PDF.
    const range = pkg.dependencies["pdfjs-dist"]!
    const [major, minor, patch] = range.replace(/^[^\d]*/, "").split(".").map(Number)
    expect([major, minor, patch] >= [6, 2, 108]).toBe(true)
    expect(major).toBeGreaterThanOrEqual(6)
  })
})

describe("trustProxy refuses a hop count", () => {
  const src = read("apps/api/src/config.ts")

  it("no longer returns a number to Fastify", () => {
    expect(src).toMatch(/function resolveTrustProxy\(\): string\b/)
    expect(src).not.toMatch(/asNumber/)
  })

  it("rejects a bare integer with an actionable message", () => {
    expect(src).toMatch(/\/\^\\d\+\$\/\.test\(raw\)/)
    expect(src).toMatch(/no longer accepts a hop count/)
    expect(src).toMatch(/comma-separated/)
  })

  it("still defaults to loopback and private ranges only", () => {
    expect(src).toMatch(/DEFAULT_TRUSTED_PROXIES/)
    expect(src).toMatch(/127\.0\.0\.1\/8/)
    expect(src).not.toMatch(/trustProxy:\s*true/)
  })
})

describe("the dead Fastify plugin stays gone", () => {
  it("is not declared anywhere", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(pkg.dependencies["@fastify/static"]).toBeUndefined()
    expect(pkg.devDependencies["@fastify/static"]).toBeUndefined()
  })
})
