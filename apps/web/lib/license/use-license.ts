"use client"

import { useQuery } from "@tanstack/react-query"

import {
  FEATURE_LABELS,
  planHasFeature,
  plansWithFeature,
  type LicenseFeatureId,
  type LicensePlanId,
  isLicenseFeatureId,
  isLicensePlanId,
  PLAN_DEFINITIONS,
} from "@arciin/shared"
import { getLicenseStatus, type LicenseStatusView } from "@/lib/api/license"
import { queryKeys } from "@/lib/api/query-keys"

export type LicenseUiState = {
  ready: boolean
  loading: boolean
  status: LicenseStatusView | null
  plan: LicensePlanId
  hasFeature: (feature: LicenseFeatureId) => boolean
  /** Lowest plan that includes this feature (for badges). */
  requiredPlanFor: (feature: LicenseFeatureId) => LicensePlanId | null
  planLabel: (plan: LicensePlanId) => string
  featureLabel: (feature: LicenseFeatureId) => string
}

const LICENSE_CACHE_KEY = "arciin-license-status-v1"
const LICENSE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

type CachedLicense = { data: LicenseStatusView; updatedAt: number }

function readCachedLicense(): CachedLicense | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(LICENSE_CACHE_KEY)
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

/**
 * License UI state.
 *
 * The last server-confirmed status is persisted so hard reloads render the
 * correct plan on first paint (no locked→unlocked flash for Pro, no
 * unlocked→locked flash for Free). A background refetch reconciles against
 * the server immediately, and the API enforces every premium feature
 * independently — this cache is UX only, never authorization.
 */
export function useLicense(): LicenseUiState {
  const query = useQuery({
    queryKey: queryKeys.licenseStatus,
    queryFn: async ({ signal }) => {
      const data = await getLicenseStatus(signal)
      try {
        window.localStorage.setItem(
          LICENSE_CACHE_KEY,
          JSON.stringify({ data, updatedAt: Date.now() } satisfies CachedLicense),
        )
      } catch {
        /* private mode / quota — cache is optional */
      }
      return data
    },
    // Seed from the persisted last-confirmed status; initialDataUpdatedAt keeps
    // it honest — anything older than staleTime refetches immediately in the
    // background while the UI renders the cached plan.
    initialData: () => readCachedLicense()?.data,
    initialDataUpdatedAt: () => readCachedLicense()?.updatedAt,
    // Short in-memory freshness window: navigating between gated pages renders
    // instantly from cache instead of blocking every page on a refetch (the
    // old staleTime: 0 + refetchOnMount: "always" caused visible delays).
    staleTime: 15_000,
    refetchOnWindowFocus: true,
    // Keep the last confirmed status during background refetches so gated
    // pages do not flash skeletons on focus or navigation.
    placeholderData: (prev) => prev,
    retry: 1,
  })

  const confirmed = query.isSuccess && !!query.data
  const plan: LicensePlanId =
    confirmed && isLicensePlanId(query.data.plan) ? query.data.plan : "free"

  const featureSet = new Set(
    (confirmed ? query.data.features : []).map((f) => f.id).filter(isLicenseFeatureId),
  )

  /**
   * Prefer live feature list from API (includes grace/expiry).
   * Until confirmed: free matrix only — never flash paid UI from stale cache.
   */
  function hasFeature(feature: LicenseFeatureId): boolean {
    if (!confirmed) {
      return planHasFeature("free", feature)
    }
    return featureSet.has(feature)
  }

  function requiredPlanFor(feature: LicenseFeatureId): LicensePlanId | null {
    const plans = plansWithFeature(feature)
    if (!plans.length) return null
    return plans.find((p) => p !== "free") ?? plans[0] ?? null
  }

  return {
    // Ready only after server confirmed — callers must lock premium while !ready
    ready: confirmed,
    loading: query.isLoading || query.isFetching,
    status: confirmed ? query.data : null,
    plan,
    hasFeature,
    requiredPlanFor,
    planLabel: (p) => PLAN_DEFINITIONS[p].name,
    featureLabel: (f) => FEATURE_LABELS[f] ?? f,
  }
}
