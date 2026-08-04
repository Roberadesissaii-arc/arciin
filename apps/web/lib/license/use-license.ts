"use client"

import { useQuery } from "@tanstack/react-query"

import {
  FEATURE_LABELS,
  decideEntitlement,
  plansWithFeature,
  snapshotFromResponse,
  type EntitlementSnapshot,
  type EntitlementState,
  type LicenseFeatureId,
  type LicensePlanId,
  isLicenseFeatureId,
  isLicensePlanId,
  PLAN_DEFINITIONS,
} from "@arciin/shared"
import { getLicenseStatus, type LicenseStatusView } from "@/lib/api/license"
import { queryKeys } from "@/lib/api/query-keys"
import { useAuth } from "@/hooks/use-auth"

export type LicenseUiState = {
  /** True once an authoritative answer — or a usable prior one — is available. */
  ready: boolean
  loading: boolean
  /** True while we genuinely do not know. Render a stable shell, never a paywall. */
  verifying: boolean
  /** True when driving from a prior answer because the server is unreachable. */
  degraded: boolean
  status: LicenseStatusView | null
  plan: LicensePlanId
  hasFeature: (feature: LicenseFeatureId) => boolean
  /** Only ever true for an authoritative Free answer. */
  shouldPaywall: (feature: LicenseFeatureId) => boolean
  requiredPlanFor: (feature: LicenseFeatureId) => LicensePlanId | null
  planLabel: (plan: LicensePlanId) => string
  featureLabel: (feature: LicenseFeatureId) => string
}

const LICENSE_CACHE_PREFIX = "arciin-license-status-v2"
const LICENSE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

type CachedLicense = { data: LicenseStatusView; updatedAt: number }

/**
 * Cache key scoped by signed-in user.
 *
 * The v1 key was global, so a Pro user's status survived logout and seeded the
 * next user's first render — a Free user briefly saw the Pro interface. The
 * version bump to v2 guarantees no stale unscoped entry is ever read.
 */
function cacheKey(userId: string | null): string {
  return `${LICENSE_CACHE_PREFIX}:${userId ?? "anonymous"}`
}

function readCachedLicense(userId: string | null): CachedLicense | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(cacheKey(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CachedLicense>
    if (!parsed?.data || typeof parsed.updatedAt !== "number") return null
    if (Date.now() - parsed.updatedAt > LICENSE_CACHE_MAX_AGE_MS) return null
    if (typeof parsed.data.plan !== "string" || !Array.isArray(parsed.data.features)) return null
    return parsed as CachedLicense
  } catch {
    return null
  }
}

function toSnapshot(
  data: LicenseStatusView,
  verifiedAt: number,
  source: string,
): EntitlementSnapshot | undefined {
  if (!isLicensePlanId(data.plan)) return undefined
  return snapshotFromResponse({
    plan: data.plan,
    featureIds: data.features.map((f) => f.id).filter(isLicenseFeatureId),
    verifiedAt: new Date(verifiedAt).toISOString(),
    source,
  })
}

/**
 * License UI state.
 *
 * Presentation only — the API enforces every premium feature independently.
 *
 * The rule this exists to enforce: **a paywall requires an authoritative Free
 * answer.** "Not loaded yet" and "the request failed" are not that. The
 * previous implementation collapsed all three into one boolean and fell back
 * to the free feature matrix whenever the query was not successful, which is
 * what showed the upgrade screen to paying Pro users whenever the entitlement
 * request timed out, 500'd, or hit a transient 401 during session hydration.
 */
export function useLicense(): LicenseUiState {
  const { data: auth } = useAuth()
  const userId = auth?.user?.id ?? null

  const query = useQuery({
    // Scoped by user so one account's plan can never seed another's.
    queryKey: queryKeys.licenseStatusFor(userId),
    queryFn: async ({ signal }) => {
      const data = await getLicenseStatus(signal)
      try {
        window.localStorage.setItem(
          cacheKey(userId),
          JSON.stringify({ data, updatedAt: Date.now() } satisfies CachedLicense),
        )
      } catch {
        /* private mode / quota — the cache is optional */
      }
      return data
    },
    initialData: () => readCachedLicense(userId)?.data,
    initialDataUpdatedAt: () => readCachedLicense(userId)?.updatedAt,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
    retry: 1,
  })

  const data = query.data
  // `dataUpdatedAt` is always set when `data` exists, so no Date.now() is
  // needed here — calling it during render would be an impure read.
  const verifiedAt = query.dataUpdatedAt
  const priorSnapshot = data ? toSnapshot(data, verifiedAt, "cache") : undefined
  const resolvedSnapshot =
    query.isSuccess && data ? toSnapshot(data, verifiedAt, "server") : undefined

  // Translate the query into the explicit state the decision function reads.
  const state: EntitlementState = query.isError
    ? { status: "error", errorCode: "LICENSE_REQUEST_FAILED", previous: priorSnapshot }
    : resolvedSnapshot
      ? { status: "resolved", snapshot: resolvedSnapshot }
      : query.isLoading || query.isFetching
        ? { status: "loading", previous: priorSnapshot }
        : { status: "unknown" }

  const decide = (feature: LicenseFeatureId) => decideEntitlement(state, feature)

  // The state-level flags are the same whichever feature is probed.
  const probe = decide("ai.chat" as LicenseFeatureId)

  return {
    ready: !probe.verifying,
    loading: query.isLoading || query.isFetching,
    verifying: probe.verifying,
    degraded: probe.degraded,
    status: query.isSuccess && data ? data : null,
    plan: probe.plan ?? "free",
    hasFeature: (feature) => decide(feature).hasFeature,
    shouldPaywall: (feature) => decide(feature).showPaywall,
    requiredPlanFor: (feature) => {
      const plans = plansWithFeature(feature)
      if (!plans.length) return null
      return plans.find((p) => p !== "free") ?? plans[0] ?? null
    },
    planLabel: (p) => PLAN_DEFINITIONS[p].name,
    featureLabel: (f) => FEATURE_LABELS[f] ?? f,
  }
}
