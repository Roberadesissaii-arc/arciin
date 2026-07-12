"use client"

import type { ReactNode } from "react"
import type { LicenseFeatureId } from "@arciin/shared"

import { PlanRequiredMessage } from "@/components/license/plan-required-message"
import { useLicense } from "@/lib/license/use-license"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Renders children when the instance license includes `feature`.
 * Otherwise shows a clear upgrade state (API still enforces independently).
 */
export function FeatureGate({
  feature,
  children,
  fallback,
}: {
  feature: LicenseFeatureId
  children: ReactNode
  fallback?: ReactNode
}) {
  const license = useLicense()

  if (license.loading && !license.status) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  if (license.hasFeature(feature)) {
    return <>{children}</>
  }

  if (fallback) return <>{fallback}</>

  const plan = license.requiredPlanFor(feature) ?? "pro"
  return (
    <PlanRequiredMessage
      plan={license.planLabel(plan)}
      featureLabel={license.featureLabel(feature)}
    />
  )
}
