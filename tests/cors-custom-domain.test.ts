import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  customOriginFromPublicUrl,
  evaluateCorsOrigin,
  type CorsDecisionContext,
} from "../apps/api/src/plugins/cors-policy"

/**
 * The owner's custom domain is a trusted origin — exactly that origin, nothing
 * wider.
 *
 * https://app.arciin.com served the sign-in page and every login came back
 * 403 "Origin not allowed": Settings → Domain stored it as the instance's
 * public URL, but nothing turned that into a trusted origin. Only the quick
 * tunnel's live URL was trusted.
 */

const REPO = path.resolve(__dirname, "..")

function ctx(overrides: Partial<CorsDecisionContext> = {}): CorsDecisionContext {
  return {
    instanceOrigins: new Set(["http://192.168.4.21:3002"]),
    configuredOrigins: new Set(),
    activeTunnelOrigin: null,
    customPublicOrigin: null,
    selfHostedInstance: true,
    isProduction: true,
    ...overrides,
  }
}

describe("custom public origin in the CORS decision", () => {
  const custom = ctx({ customPublicOrigin: "https://app.arciin.com" })

  it("A: the configured custom domain is allowed", () => {
    expect(evaluateCorsOrigin("https://app.arciin.com", custom)).toBe(true)
  })

  it("B: an unrelated domain is denied", () => {
    expect(evaluateCorsOrigin("https://evil.example.com", custom)).toBe(false)
  })

  it("C: no subdomain, parent, lookalike, other scheme or port is implied", () => {
    for (const origin of [
      "https://other.arciin.com",
      "https://arciin.com",
      "https://app.arciin.com.evil.com",
      "https://xapp.arciin.com",
      "http://app.arciin.com",
      "https://app.arciin.com:8443",
    ]) {
      expect(evaluateCorsOrigin(origin, custom), origin).toBe(false)
    }
  })

  it("nothing is trusted from the custom slot when none is configured", () => {
    expect(evaluateCorsOrigin("https://app.arciin.com", ctx())).toBe(false)
  })

  it("F/G: the quick tunnel is trusted only while that exact tunnel runs", () => {
    const live = ctx({ activeTunnelOrigin: "https://abc-def.trycloudflare.com" })
    expect(evaluateCorsOrigin("https://abc-def.trycloudflare.com", live)).toBe(true)
    expect(evaluateCorsOrigin("https://other-name.trycloudflare.com", live)).toBe(false)
    expect(evaluateCorsOrigin("https://abc-def.trycloudflare.com", ctx())).toBe(false)
  })

  it("custom domain and live quick tunnel are trusted side by side", () => {
    const both = ctx({ customPublicOrigin: "https://app.arciin.com", activeTunnelOrigin: "https://abc-def.trycloudflare.com" })
    expect(evaluateCorsOrigin("https://app.arciin.com", both)).toBe(true)
    expect(evaluateCorsOrigin("https://abc-def.trycloudflare.com", both)).toBe(true)
  })

  it("H: explicit operator origins still work", () => {
    expect(evaluateCorsOrigin("https://extra.example.com", ctx({ configuredOrigins: new Set(["https://extra.example.com"]) }))).toBe(true)
  })

  it("I: LAN origins only for a LAN-hosted instance, as before", () => {
    expect(evaluateCorsOrigin("http://192.168.4.99:3002", ctx())).toBe(true)
    expect(evaluateCorsOrigin("http://192.168.4.99:3002", ctx({ selfHostedInstance: false }))).toBe(false)
  })

  it("J: localhost behaves as before — dev-only unless the instance itself is LAN-hosted", () => {
    const publicInstance = ctx({ selfHostedInstance: false })
    expect(evaluateCorsOrigin("http://localhost:3000", publicInstance)).toBe(false)
    expect(evaluateCorsOrigin("http://localhost:3000", { ...publicInstance, isProduction: false })).toBe(true)
  })
})

describe("turning a stored public URL into a trusted origin", () => {
  const prod = { isProduction: true }

  it("L: path, query, case and default port are normalised away", () => {
    expect(customOriginFromPublicUrl("https://APP.Arciin.com:443/login?next=/files#x", prod)).toEqual({
      origin: "https://app.arciin.com",
      publicHost: true,
    })
    expect(customOriginFromPublicUrl("  https://files.example.com:8443/  ", prod)).toMatchObject({ origin: "https://files.example.com:8443" })
  })

  it.each([
    ["", "empty"],
    [null, "empty"],
    ["not a url", "malformed"],
    ["ftp://app.arciin.com", "scheme"],
    ["javascript:alert(1)", "scheme"],
    ["https://user:pass@app.arciin.com", "credentials"],
    ["https://abc-def.trycloudflare.com", "quick-tunnel"],
    ["http://app.arciin.com", "insecure"],
  ] as const)("K: %s is not trusted (%s)", (value, reason) => {
    expect(customOriginFromPublicUrl(value, prod)).toEqual({ origin: null, reason })
  })

  it("a LAN or private hostname may be plain http and is not a public host", () => {
    expect(customOriginFromPublicUrl("http://192.168.4.21:3002", prod)).toEqual({ origin: "http://192.168.4.21:3002", publicHost: false })
  })

  it("plain http for a public host is accepted outside production only", () => {
    expect(customOriginFromPublicUrl("http://app.arciin.com", { isProduction: false })).toMatchObject({ origin: "http://app.arciin.com" })
  })
})

describe("every origin decision goes through one policy", () => {
  it("P: Socket.IO uses isCorsOriginAllowed, not a separate list", () => {
    const socket = readFileSync(path.join(REPO, "apps/api/src/plugins/socket.ts"), "utf8")
    const code = socket.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    expect(code).toContain("isCorsOriginAllowed(origin)")
    expect(code).not.toMatch(/localhost:3000|corsOrigins|isSelfHostedLanOrigin|instancePublic/)
  })

  it("HTTP CORS and the SSE stream use it too", () => {
    const cors = readFileSync(path.join(REPO, "apps/api/src/plugins/cors.ts"), "utf8")
    const origins = readFileSync(path.join(REPO, "apps/api/src/plugins/cors-origins.ts"), "utf8")
    expect(cors).toContain("isCorsOriginAllowed(origin)")
    expect(origins).toMatch(/corsHeadersForRequestOrigin[\s\S]*isCorsOriginAllowed\(origin\)/)
    expect(origins).toContain("customPublicOrigin: trustedCustomPublicOrigin")
  })

  it("the trusted custom origin has one writer, and it is refreshed at startup, on Settings saves and on MFA changes", () => {
    const server = readFileSync(path.join(REPO, "apps/api/src/server.ts"), "utf8")
    const settings = readFileSync(path.join(REPO, "apps/api/src/modules/settings/routes.ts"), "utf8")
    const auth = readFileSync(path.join(REPO, "apps/api/src/modules/auth/routes.ts"), "utf8")
    expect(server).toContain("refreshTrustedCustomPublicOrigin(fastify.prisma")
    expect(settings).toMatch(/instanceConfig\.update\([\s\S]*?applyCustomPublicOriginState\(/)
    expect(auth.match(/refreshTrustedCustomPublicOrigin\(fastify\.prisma/g)?.length).toBe(2)
  })
})
