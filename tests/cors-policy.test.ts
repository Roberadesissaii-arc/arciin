import { describe, expect, it } from "vitest"

import {
  evaluateCorsOrigin,
  normalizeOrigin,
  type CorsDecisionContext,
} from "../apps/api/src/plugins/cors-policy"

/**
 * The CORS allowlist.
 *
 * This exists because of a measured failure, not a hypothetical one: with a LAN
 * `ARCIIN_PUBLIC_URL` — the default for a self-hosted install — the API answered
 *
 *     curl -H "Origin: https://evil.example.com" .../api/health
 *     access-control-allow-origin: https://evil.example.com
 *     access-control-allow-credentials: true
 *
 * for *any* origin. The deny cases below are each one of the branches that
 * produced that, so a regression shows up here rather than in a pen test.
 */

const LAN_INSTANCE: CorsDecisionContext = {
  instanceOrigins: new Set(["http://192.168.4.53:3002"]),
  configuredOrigins: new Set(),
  activeTunnelOrigin: null,
  selfHostedInstance: true,
  isProduction: true,
}

const PUBLIC_INSTANCE: CorsDecisionContext = {
  instanceOrigins: new Set(["https://arciin.example.com"]),
  configuredOrigins: new Set(),
  activeTunnelOrigin: null,
  selfHostedInstance: false,
  isProduction: true,
}

describe("normalizeOrigin", () => {
  it("canonicalises scheme and host, dropping any path", () => {
    expect(normalizeOrigin("HTTPS://Example.COM/some/path")).toBe("https://example.com")
    expect(normalizeOrigin("http://example.com:80")).toBe("http://example.com")
  })

  it("returns null for anything that is not a usable web origin", () => {
    expect(normalizeOrigin("null")).toBeNull() // sandboxed iframe
    expect(normalizeOrigin("file:///etc/passwd")).toBeNull()
    expect(normalizeOrigin("not a url")).toBeNull()
    expect(normalizeOrigin("")).toBeNull()
    expect(normalizeOrigin(undefined)).toBeNull()
  })
})

describe("evaluateCorsOrigin — allow", () => {
  it("allows the instance's own public URL", () => {
    expect(evaluateCorsOrigin("http://192.168.4.53:3002", LAN_INSTANCE)).toBe(true)
    expect(evaluateCorsOrigin("https://arciin.example.com", PUBLIC_INSTANCE)).toBe(true)
  })

  it("allows an explicitly configured mobile origin", () => {
    const ctx = {
      ...PUBLIC_INSTANCE,
      configuredOrigins: new Set(["https://arciin-mobile.vercel.app"]),
    }
    expect(evaluateCorsOrigin("https://arciin-mobile.vercel.app", ctx)).toBe(true)
  })

  it("allows the tunnel URL that is currently running", () => {
    const ctx = { ...PUBLIC_INSTANCE, activeTunnelOrigin: "https://calm-fox-123.trycloudflare.com" }
    expect(evaluateCorsOrigin("https://calm-fox-123.trycloudflare.com", ctx)).toBe(true)
  })

  it("allows other private addresses when the instance is itself on the LAN", () => {
    // Reaching the same server by a second private address (hostname, another
    // interface, Tailscale) is ordinary; an attacker's origin is never RFC1918.
    expect(evaluateCorsOrigin("http://192.168.4.99:3002", LAN_INSTANCE)).toBe(true)
    expect(evaluateCorsOrigin("http://10.0.0.5", LAN_INSTANCE)).toBe(true)
  })

  it("allows localhost in development only", () => {
    const dev = { ...PUBLIC_INSTANCE, isProduction: false }
    expect(evaluateCorsOrigin("http://localhost:3100", dev)).toBe(true)
    expect(evaluateCorsOrigin("http://localhost:3100", PUBLIC_INSTANCE)).toBe(false)
  })

  it("treats a missing Origin header as not a CORS decision", () => {
    expect(evaluateCorsOrigin(undefined, PUBLIC_INSTANCE)).toBe(true)
  })
})

describe("evaluateCorsOrigin — deny", () => {
  it("denies an arbitrary origin against a LAN instance", () => {
    // The exact case that was measured as allowed.
    expect(evaluateCorsOrigin("https://evil.example.com", LAN_INSTANCE)).toBe(false)
  })

  it("denies an arbitrary origin against a public instance", () => {
    expect(evaluateCorsOrigin("https://evil.example.com", PUBLIC_INSTANCE)).toBe(false)
  })

  it("denies a vercel.app host that was not explicitly configured", () => {
    // The old rule trusted every *.vercel.app, i.e. anyone who can deploy.
    expect(evaluateCorsOrigin("https://attacker.vercel.app", PUBLIC_INSTANCE)).toBe(false)
    expect(evaluateCorsOrigin("https://attacker.vercel.app", LAN_INSTANCE)).toBe(false)
  })

  it("denies a trycloudflare host that is not the running tunnel", () => {
    const ctx = { ...PUBLIC_INSTANCE, activeTunnelOrigin: "https://calm-fox-123.trycloudflare.com" }
    expect(evaluateCorsOrigin("https://attacker-999.trycloudflare.com", ctx)).toBe(false)
  })

  it("denies the previous tunnel URL once cloudflared has stopped", () => {
    // A dead quick-tunnel hostname is reassignable to someone else.
    expect(
      evaluateCorsOrigin("https://calm-fox-123.trycloudflare.com", PUBLIC_INSTANCE),
    ).toBe(false)
  })

  it.each([
    ["null", "sandboxed iframe / opaque origin"],
    ["file:///etc/passwd", "file scheme"],
    ["javascript:alert(1)", "javascript scheme"],
    ["not a url", "unparseable"],
    ["", "empty"],
  ])("denies %s (%s) — parse failure must not mean allow", (origin) => {
    expect(evaluateCorsOrigin(origin, LAN_INSTANCE)).toBe(false)
    expect(evaluateCorsOrigin(origin, PUBLIC_INSTANCE)).toBe(false)
  })

  it("does not let a public instance accept LAN origins", () => {
    expect(evaluateCorsOrigin("http://192.168.4.99:3002", PUBLIC_INSTANCE)).toBe(false)
  })

  it("does not match on a suffix of a configured origin", () => {
    const ctx = {
      ...PUBLIC_INSTANCE,
      configuredOrigins: new Set(["https://arciin.example.com"]),
    }
    expect(evaluateCorsOrigin("https://evil-arciin.example.com", ctx)).toBe(false)
    expect(evaluateCorsOrigin("https://arciin.example.com.evil.test", ctx)).toBe(false)
  })
})
