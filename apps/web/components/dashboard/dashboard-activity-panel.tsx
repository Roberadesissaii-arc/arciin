"use client"

import { ActivityFeed } from "@/components/activity/activity-feed"
import {
  DASHBOARD_ACTIVITY_LIMIT,
  DASHBOARD_ACTIVITY_LIMIT_TABLET,
  dashboardOverviewActivityBody,
} from "@/lib/dashboard-card-styles"
import { useIsTablet } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

export { DASHBOARD_ACTIVITY_LIMIT, DASHBOARD_ACTIVITY_LIMIT_TABLET }

/** 6 rows on desktop, 5 on tablet — keeps the feed level with uploads as the screen shrinks. */
export function DashboardActivityPanel({ className }: { className?: string }) {
  const isTablet = useIsTablet()
  const limit = isTablet ? DASHBOARD_ACTIVITY_LIMIT_TABLET : DASHBOARD_ACTIVITY_LIMIT

  return (
    <div className={cn(dashboardOverviewActivityBody, className)}>
      <ActivityFeed limit={limit} dashboard />
    </div>
  )
}
