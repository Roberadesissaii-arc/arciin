import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  API_KEY_ACTION_BASE,
  API_KEY_REVOKE_CLASS,
  API_KEY_ROTATE_CLASS,
  apiKeyExpiryLabel,
  apiKeyLastUsedLabel,
  apiKeyRateLimitLabel,
} from "../apps/web/lib/utils/api-key-display"

/**
 * The API key table's information hierarchy: Prefix carries the rate limit,
 * Scopes carries the expiry, Last used carries only last use. Rotate is a
 * solid neutral action, Revoke a solid destructive one.
 */

const TABLE = readFileSync("apps/web/components/settings/api-keys-table.tsx", "utf8")
const NOW = new Date("2026-09-28T12:00:00Z")
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString()

describe("labels", () => {
  it("rate limit is short, and says when there is none", () => {
    expect(apiKeyRateLimitLabel(600)).toBe("600 req/min")
    expect(apiKeyRateLimitLabel(12000)).toBe("12,000 req/min")
    expect(apiKeyRateLimitLabel(null)).toBe("No rate limit")
    expect(apiKeyRateLimitLabel(0)).toBe("No rate limit")
  })

  it("expiry reads naturally and flags keys that never expire", () => {
    expect(apiKeyExpiryLabel(inDays(90), NOW).text).toMatch(/^Expires in 3 months$/)
    expect(apiKeyExpiryLabel(inDays(1), NOW)).toEqual({ text: "Expires tomorrow", tone: "muted" })
    expect(apiKeyExpiryLabel(null, NOW)).toEqual({ text: "No expiration", tone: "warning" })
    expect(apiKeyExpiryLabel(inDays(-2), NOW)).toMatchObject({ tone: "warning", text: expect.stringMatching(/^Expired /) })
  })

  it("last used is one value", () => {
    expect(apiKeyLastUsedLabel(null)).toBe("Never")
    expect(apiKeyLastUsedLabel(new Date(Date.now() - 3 * 86_400_000).toISOString())).toBe("3 days ago")
  })
})

describe("table layout", () => {
  const cell = (testId: string) => {
    const at = TABLE.indexOf(`data-testid="${testId}"`)
    expect(at, testId).toBeGreaterThan(-1)
    return TABLE.slice(at, TABLE.indexOf("</div>", at) > -1 ? TABLE.indexOf("</div>", at) : at + 600)
  }

  it("Prefix shows the key prefix and the rate limit", () => {
    const prefix = cell("api-key-prefix")
    expect(prefix).toContain("apiKey.keyPrefix")
    expect(prefix).toContain("{rateLimit}")
  })

  it("Scopes shows the badges and the expiry, amber when there is none", () => {
    const scopes = cell("api-key-scopes")
    expect(scopes).toContain("<ApiKeyScopeBadges")
    expect(scopes).toContain("{expiry.text}")
    expect(scopes).toContain("text-amber-600")
  })

  it("Last used holds last use only", () => {
    const at = TABLE.indexOf('data-testid="api-key-last-used"')
    const lastUsed = TABLE.slice(at, TABLE.indexOf("</p>", at))
    expect(lastUsed).toContain("{lastUsed}")
    expect(lastUsed).not.toMatch(/expir|rate|req/i)
  })

  it("narrow screens label each value", () => {
    expect(TABLE).toContain("Rate limit · {rateLimit}")
    expect(TABLE).toContain('<span className="lg:hidden">Last used · </span>')
  })

  it("Rotate is solid and neutral — not outline, not orange, not red", () => {
    const at = TABLE.indexOf('data-testid="api-key-rotate"')
    const rotate = TABLE.slice(TABLE.lastIndexOf("<Button", at), TABLE.indexOf("</Button>", at))
    expect(rotate).not.toMatch(/variant="(outline|ghost|destructive)"/)
    expect(rotate).toContain("API_KEY_ROTATE_CLASS")
    expect(API_KEY_ROTATE_CLASS).toMatch(/\bbg-zinc-900\b/)
    expect(API_KEY_ROTATE_CLASS).toMatch(/\btext-white\b/)
    expect(API_KEY_ROTATE_CLASS).not.toMatch(/bg-(primary|red|orange|destructive)|bg-transparent|bg-card/)
    expect(API_KEY_ROTATE_CLASS).toMatch(/disabled:/)
  })

  it("Revoke stays solid red, and both buttons share one size", () => {
    const at = TABLE.indexOf('data-testid="api-key-revoke"')
    const revoke = TABLE.slice(TABLE.lastIndexOf("<Button", at), TABLE.indexOf("</Button>", at))
    expect(revoke).toContain('variant="destructive"')
    expect(revoke).toContain("API_KEY_REVOKE_CLASS")
    // Solid in both themes: the shared variant's translucent dark tint is overridden.
    expect(API_KEY_REVOKE_CLASS).toMatch(/(^| )bg-red-600( |$)/)
    expect(API_KEY_REVOKE_CLASS).toMatch(/dark:bg-red-600/)
    expect(API_KEY_REVOKE_CLASS).toMatch(/\btext-white\b/)
    expect(revoke).toContain("API_KEY_ACTION_BASE")
    expect(API_KEY_ACTION_BASE).toMatch(/\bh-8\b/)
    expect(API_KEY_ACTION_BASE).toMatch(/\bw-\[104px\]/)
  })
})
