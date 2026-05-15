import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  evaluateIpAccess,
  ipMatchesRule,
  normalizeIpRule,
  parseApiProtectionConfig,
} from "./api-protection.js"

describe("api-protection", () => {
  it("parses config with defaults", () => {
    const cfg = parseApiProtectionConfig({})
    assert.equal(cfg.apiGlobalRequestsPerMinute, 0)
    assert.equal(cfg.apiKeyRequestsPerMinute, 0)
  })

  it("normalizes IPv4 and CIDR", () => {
    assert.equal(normalizeIpRule(" 10.0.0.1 "), "10.0.0.1")
    assert.equal(normalizeIpRule("192.168.0.0/24"), "192.168.0.0/24")
    assert.equal(normalizeIpRule("not-an-ip"), null)
  })

  it("matches CIDR rules", () => {
    assert.equal(ipMatchesRule("10.0.0.5", "10.0.0.0/8"), true)
    assert.equal(ipMatchesRule("10.0.0.5", "192.168.0.0/24"), false)
  })

  it("blocks listed IPs", () => {
    const r = evaluateIpAccess("203.0.113.9", {
      ipBlocklist: ["203.0.113.9"],
      ipAllowlist: [],
      enforceIpAllowlist: false,
    })
    assert.equal(r.allowed, false)
    assert.equal(r.reason, "ip_blocked")
  })

  it("always allows loopback", () => {
    const r = evaluateIpAccess("127.0.0.1", {
      ipBlocklist: ["127.0.0.1"],
      ipAllowlist: [],
      enforceIpAllowlist: true,
    })
    assert.equal(r.allowed, true)
  })

  it("does not block everyone when allowlist is empty", () => {
    const r = evaluateIpAccess("203.0.113.1", {
      ipBlocklist: [],
      ipAllowlist: [],
      enforceIpAllowlist: true,
    })
    assert.equal(r.allowed, true)
  })

  it("enforces allowlist when enabled", () => {
    const denied = evaluateIpAccess("1.2.3.4", {
      ipBlocklist: [],
      ipAllowlist: ["10.0.0.0/8"],
      enforceIpAllowlist: true,
    })
    assert.equal(denied.allowed, false)

    const ok = evaluateIpAccess("10.1.2.3", {
      ipBlocklist: [],
      ipAllowlist: ["10.0.0.0/8"],
      enforceIpAllowlist: true,
    })
    assert.equal(ok.allowed, true)
  })
})
