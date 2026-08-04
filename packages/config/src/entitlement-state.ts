import {
  PLAN_DEFINITIONS,
  planHasFeature,
  type LicenseFeatureId,
  type LicensePlanId,
} from "./entitlements"

/**
 * Entitlement as an explicit state, not a boolean.
 *
 * The Pro paywall flash came from collapsing three different situations into
 * one "not Pro" boolean:
 *
 *   - we have not asked yet
 *   - we asked and the request failed
 *   - we asked and the server said Free
 *
 * Only the third is grounds for showing a paywall. The old `useLicense`
 * returned the *free* feature matrix whenever `!confirmed`, so a timeout, a
 * 500, or a transient 401 during session hydration downgraded a paying user
 * and rendered the upgrade screen over their Pro interface.
 *
 * Pure and framework-free so every transition is unit-testable. The API
 * enforces entitlements independently — this decides presentation only, and
 * must never be the authorization boundary.
 */

export type EntitlementSnapshot = {
  plan: LicensePlanId
  featureIds: LicenseFeatureId[]
  /** ISO timestamp of the server response this came from. */
  verifiedAt: string
  /** Where it came from, for diagnostics: "server" | "cache". */
  source: string
}

export type EntitlementState =
  | { status: "unknown" }
  | { status: "loading"; previous?: EntitlementSnapshot }
  | { status: "resolved"; snapshot: EntitlementSnapshot }
  | { status: "error"; errorCode: string; previous?: EntitlementSnapshot }

/**
 * How long a previously confirmed entitlement keeps driving the UI after the
 * server stops answering.
 *
 * Long enough to ride out a restart or a flaky network; short enough that a
 * genuinely cancelled plan reverts on the same day. Backend enforcement is
 * unaffected either way.
 */
export const ENTITLEMENT_GRACE_MS = 12 * 60 * 60 * 1000

/** What the UI should do right now. */
export type EntitlementDecision = {
  /** True only when an authoritative Free answer justifies a paywall. */
  showPaywall: boolean
  /** True while we genuinely do not know — render a stable shell, never a paywall. */
  verifying: boolean
  /** Plan to display. Null while unknown. */
  plan: LicensePlanId | null
  /** Whether the feature may be presented as available. */
  hasFeature: boolean
  /** True when driving from a previous snapshot because the server is unreachable. */
  degraded: boolean
}

function snapshotHasFeature(
  snapshot: EntitlementSnapshot,
  feature: LicenseFeatureId,
): boolean {
  return snapshot.featureIds.includes(feature)
}

function withinGrace(snapshot: EntitlementSnapshot, now: number, graceMs: number): boolean {
  const verified = Date.parse(snapshot.verifiedAt)
  if (Number.isNaN(verified)) return false
  return now - verified <= graceMs
}

/**
 * Decide how to present one feature.
 *
 * The rule that matters: a paywall requires a *resolved* state whose snapshot
 * genuinely lacks the feature. Unknown, loading, and error never produce one.
 */
export function decideEntitlement(
  state: EntitlementState,
  feature: LicenseFeatureId,
  options: { now?: number; graceMs?: number } = {},
): EntitlementDecision {
  const now = options.now ?? Date.now()
  const graceMs = options.graceMs ?? ENTITLEMENT_GRACE_MS

  switch (state.status) {
    case "unknown":
      // Never paywall on ignorance — show a stable verifying shell.
      return { showPaywall: false, verifying: true, plan: null, hasFeature: false, degraded: false }

    case "loading": {
      // A previously confirmed snapshot keeps driving the UI so a refresh does
      // not tear down the Pro interface and rebuild it.
      if (state.previous) {
        return {
          showPaywall: false,
          verifying: false,
          plan: state.previous.plan,
          hasFeature: snapshotHasFeature(state.previous, feature),
          degraded: false,
        }
      }
      return { showPaywall: false, verifying: true, plan: null, hasFeature: false, degraded: false }
    }

    case "resolved": {
      const has = snapshotHasFeature(state.snapshot, feature)
      return {
        showPaywall: !has,
        verifying: false,
        plan: state.snapshot.plan,
        hasFeature: has,
        degraded: false,
      }
    }

    case "error": {
      // A failed request is not evidence of a downgrade. Ride on the last
      // confirmed answer while it is inside the grace window.
      if (state.previous && withinGrace(state.previous, now, graceMs)) {
        return {
          showPaywall: false,
          verifying: false,
          plan: state.previous.plan,
          hasFeature: snapshotHasFeature(state.previous, feature),
          degraded: true,
        }
      }
      // No usable prior answer: still do not assert Free. Keep verifying —
      // the API refuses unauthorized use regardless of what the UI shows.
      return { showPaywall: false, verifying: true, plan: null, hasFeature: false, degraded: true }
    }
  }
}

/**
 * Build a snapshot from a server response.
 * Falls back to the plan's static matrix when the response omits features.
 */
export function snapshotFromResponse(input: {
  plan: LicensePlanId
  featureIds?: LicenseFeatureId[]
  verifiedAt?: string
  source?: string
}): EntitlementSnapshot {
  return {
    plan: input.plan,
    // The live list is preferred because it reflects grace periods and
    // expiry; the static plan matrix is the fallback when the response
    // omits it.
    featureIds: input.featureIds ?? [...PLAN_DEFINITIONS[input.plan].features],
    verifiedAt: input.verifiedAt ?? new Date().toISOString(),
    source: input.source ?? "server",
  }
}

/** Whether a plan statically includes a feature (used for badges, not gating). */
export function planIncludes(plan: LicensePlanId, feature: LicenseFeatureId): boolean {
  return planHasFeature(plan, feature)
}
