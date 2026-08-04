import { describe, expect, it } from "vitest"

import {
  ENTITLEMENT_GRACE_MS,
  decideEntitlement,
  snapshotFromResponse,
  type EntitlementSnapshot,
} from "@arciin/config"

/**
 * The Pro paywall flash.
 *
 * The old `useLicense` computed `confirmed = query.isSuccess && !!query.data`
 * and then did:
 *
 *     if (!confirmed) return planHasFeature("free", feature)
 *
 * so "we don't know yet" and "the request failed" both resolved to the *free*
 * matrix. `FeatureGate` renders `PlanRequiredMessage` whenever `hasFeature` is
 * false and it is not in its narrow skeleton window, so a paying Pro user saw
 * the upgrade screen whenever the entitlement request failed.
 *
 * These cases pin the rule that replaces it: a paywall requires an
 * authoritative Free answer. Nothing else produces one.
 */

const FEATURE = "ai.chat" as never
const NOW = Date.parse("2026-08-04T12:00:00Z")

const proSnapshot: EntitlementSnapshot = {
  plan: "pro",
  featureIds: [FEATURE],
  verifiedAt: new Date(NOW - 60_000).toISOString(),
  source: "server",
}

const freeSnapshot: EntitlementSnapshot = {
  plan: "free",
  featureIds: [],
  verifiedAt: new Date(NOW - 60_000).toISOString(),
  source: "server",
}

describe("unknown — we have not asked yet", () => {
  it("never shows the paywall", () => {
    const d = decideEntitlement({ status: "unknown" }, FEATURE, { now: NOW })
    expect(d.showPaywall).toBe(false)
    expect(d.verifying).toBe(true)
    expect(d.plan).toBeNull()
  })
})

describe("loading", () => {
  it("shows a verifying shell on a cold start, not a paywall", () => {
    const d = decideEntitlement({ status: "loading" }, FEATURE, { now: NOW })
    expect(d.showPaywall).toBe(false)
    expect(d.verifying).toBe(true)
  })

  it("keeps a Pro user on the Pro interface while revalidating", () => {
    // This is the refresh case: the page must not tear down and rebuild.
    const d = decideEntitlement(
      { status: "loading", previous: proSnapshot },
      FEATURE,
      { now: NOW },
    )
    expect(d.showPaywall).toBe(false)
    expect(d.verifying).toBe(false)
    expect(d.hasFeature).toBe(true)
    expect(d.plan).toBe("pro")
  })
})

describe("resolved — the only state that may paywall", () => {
  it("grants the feature to Pro", () => {
    const d = decideEntitlement({ status: "resolved", snapshot: proSnapshot }, FEATURE, {
      now: NOW,
    })
    expect(d.hasFeature).toBe(true)
    expect(d.showPaywall).toBe(false)
    expect(d.degraded).toBe(false)
  })

  it("shows the paywall to Free — gating still works", () => {
    const d = decideEntitlement({ status: "resolved", snapshot: freeSnapshot }, FEATURE, {
      now: NOW,
    })
    expect(d.showPaywall).toBe(true)
    expect(d.hasFeature).toBe(false)
    expect(d.verifying).toBe(false)
  })
})

describe("error — the regression that caused the flash", () => {
  it("does NOT downgrade a Pro user when the request fails", () => {
    // The exact reported symptom: entitlement request fails, paying user is
    // shown "Upgrade to Pro".
    const d = decideEntitlement(
      { status: "error", errorCode: "NETWORK_ERROR", previous: proSnapshot },
      FEATURE,
      { now: NOW },
    )
    expect(d.showPaywall).toBe(false)
    expect(d.hasFeature).toBe(true)
    expect(d.plan).toBe("pro")
    expect(d.degraded).toBe(true)
  })

  it("treats a timeout the same as any other failure", () => {
    for (const code of ["TIMEOUT", "HTTP_500", "HTTP_401", "OFFLINE"]) {
      const d = decideEntitlement(
        { status: "error", errorCode: code, previous: proSnapshot },
        FEATURE,
        { now: NOW },
      )
      expect(d.showPaywall, code).toBe(false)
      expect(d.hasFeature, code).toBe(true)
    }
  })

  it("still refuses to assert Free when there is no prior answer", () => {
    // Worst case — cold start plus a failing endpoint. Keep verifying; the API
    // rejects unauthorized use regardless of what the UI shows.
    const d = decideEntitlement({ status: "error", errorCode: "HTTP_500" }, FEATURE, {
      now: NOW,
    })
    expect(d.showPaywall).toBe(false)
    expect(d.verifying).toBe(true)
    expect(d.hasFeature).toBe(false)
  })

  it("stops trusting a stale snapshot once the grace window closes", () => {
    // A genuinely cancelled plan must not ride on a cached Pro answer forever.
    const stale: EntitlementSnapshot = {
      ...proSnapshot,
      verifiedAt: new Date(NOW - ENTITLEMENT_GRACE_MS - 1000).toISOString(),
    }
    const d = decideEntitlement(
      { status: "error", errorCode: "NETWORK_ERROR", previous: stale },
      FEATURE,
      { now: NOW },
    )
    expect(d.hasFeature).toBe(false)
    // But it still does not claim Free — it goes back to verifying.
    expect(d.showPaywall).toBe(false)
    expect(d.verifying).toBe(true)
  })

  it("does not resurrect Pro for a user whose last confirmed answer was Free", () => {
    const d = decideEntitlement(
      { status: "error", errorCode: "NETWORK_ERROR", previous: freeSnapshot },
      FEATURE,
      { now: NOW },
    )
    expect(d.hasFeature).toBe(false)
    // Free + error is still not authoritative, so no paywall flash either way.
    expect(d.showPaywall).toBe(false)
  })

  it("ignores an unparseable verifiedAt rather than trusting it", () => {
    const d = decideEntitlement(
      {
        status: "error",
        errorCode: "X",
        previous: { ...proSnapshot, verifiedAt: "not-a-date" },
      },
      FEATURE,
      { now: NOW },
    )
    expect(d.hasFeature).toBe(false)
    expect(d.verifying).toBe(true)
  })
})

describe("the paywall is reachable from exactly one state", () => {
  it("only a resolved snapshot lacking the feature shows it", () => {
    const states = [
      { status: "unknown" } as const,
      { status: "loading" } as const,
      { status: "loading", previous: proSnapshot } as const,
      { status: "loading", previous: freeSnapshot } as const,
      { status: "error", errorCode: "E" } as const,
      { status: "error", errorCode: "E", previous: proSnapshot } as const,
      { status: "error", errorCode: "E", previous: freeSnapshot } as const,
      { status: "resolved", snapshot: proSnapshot } as const,
      { status: "resolved", snapshot: freeSnapshot } as const,
    ]

    const paywalled = states.filter(
      (s) => decideEntitlement(s, FEATURE, { now: NOW }).showPaywall,
    )

    expect(paywalled).toHaveLength(1)
    expect(paywalled[0]).toEqual({ status: "resolved", snapshot: freeSnapshot })
  })
})

describe("snapshotFromResponse", () => {
  it("prefers the live feature list, which reflects grace and expiry", () => {
    const snap = snapshotFromResponse({ plan: "pro", featureIds: [FEATURE] })
    expect(snap.featureIds).toEqual([FEATURE])
    expect(snap.source).toBe("server")
  })

  it("falls back to the plan matrix when the response omits features", () => {
    const snap = snapshotFromResponse({ plan: "free" })
    expect(Array.isArray(snap.featureIds)).toBe(true)
    expect(snap.plan).toBe("free")
  })

  it("records when it was verified, so grace can be evaluated later", () => {
    const snap = snapshotFromResponse({ plan: "pro", verifiedAt: proSnapshot.verifiedAt })
    expect(snap.verifiedAt).toBe(proSnapshot.verifiedAt)
  })
})
