"use client"

import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { DashboardActivityPanel } from "@/components/dashboard/dashboard-activity-panel"
import { DashboardHomeIntro } from "@/components/dashboard/dashboard-home-intro"
import { DashboardMediaSpotlight } from "@/components/dashboard/dashboard-media-spotlight"
import { DashboardSectionDivider } from "@/components/dashboard/dashboard-section"
import { RecentUploadsPanel } from "@/components/dashboard/recent-uploads-panel"
import { StorageDonutCard } from "@/components/dashboard/storage-donut-card"
import { SystemStatusSection } from "@/components/dashboard/system-status-section"
import { dashboardOverviewPanelCard, dashboardPanelCard } from "@/lib/dashboard-card-styles"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

const DASHBOARD_SPLIT =
  "grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-stretch"

function DashboardListPanel({
  title,
  description,
  href,
  children,
  className,
  overview = false,
}: {
  title: string
  description: string
  href: string
  children: React.ReactNode
  className?: string
  /** Compact overview row — matches uploads grid height without extra min-height. */
  overview?: boolean
}) {
  return (
    <Card
      className={cn(
        overview ? dashboardOverviewPanelCard : dashboardPanelCard,
        "overflow-hidden border-zinc-200/80 bg-card shadow-sm",
        className,
      )}
    >
      <CardHeader className="space-y-1 border-b border-zinc-100/80 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5 border-l-2 border-primary pl-3">
            <CardTitle className="font-heading text-base font-semibold tracking-tight text-zinc-900">
              {title}
            </CardTitle>
            <CardDescription className="text-sm text-zinc-600">{description}</CardDescription>
          </div>
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-lg px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-[var(--arciin-accent-badge-bg)] hover:text-primary"
          >
            View all
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          "flex min-h-0 flex-col px-4 sm:px-5",
          overview ? "flex-1 py-2.5" : "flex-1 py-3",
        )}
      >
        {children}
      </CardContent>
    </Card>
  )
}

export function DashboardHome() {
  return (
    <div className="flex flex-col gap-10 md:gap-8">
      <DashboardHomeIntro />

      <div className={DASHBOARD_SPLIT}>
        <StorageDonutCard className="h-full" />
        <DashboardMediaSpotlight className="h-full" />
      </div>

      <DashboardSectionDivider />

      <div className={DASHBOARD_SPLIT}>
        <DashboardListPanel
          title="Recent uploads"
          description="Latest files saved on this server."
          href="/uploads"
          overview
        >
          <RecentUploadsPanel />
        </DashboardListPanel>
        <DashboardListPanel
          title="Recent activity"
          description="Latest events on this instance."
          href="/activity"
          overview
        >
          <DashboardActivityPanel />
        </DashboardListPanel>
      </div>

      <DashboardSectionDivider />

      <SystemStatusSection />
    </div>
  )
}
