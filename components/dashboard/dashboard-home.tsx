"use client"

import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { ActivityCard } from "@/components/dashboard/activity-card"
import { DashboardHomeIntro } from "@/components/dashboard/dashboard-home-intro"
import { DashboardSection } from "@/components/dashboard/dashboard-section"
import { LibrarySummaryCard } from "@/components/dashboard/library-summary-card"
import { RecentUploadsCard } from "@/components/dashboard/recent-uploads-card"
import { StorageOverviewCard } from "@/components/dashboard/storage-overview-card"
import { SystemHealthCard } from "@/components/dashboard/system-health-card"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

function DashboardTwinPanel({
  title,
  description,
  href,
  children,
}: {
  title: string
  description: string
  href: string
  children: React.ReactNode
}) {
  return (
    <Card className="flex min-h-[22rem] flex-col border-border bg-card shadow-sm">
      <CardHeader className="space-y-1 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <CardTitle className="text-base font-semibold text-foreground">{title}</CardTitle>
            <CardDescription className="text-sm text-zinc-600">{description}</CardDescription>
          </div>
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-primary hover:text-primary/80"
          >
            View all
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col pt-0">{children}</CardContent>
    </Card>
  )
}

export function DashboardHome() {
  return (
    <div className="flex flex-col gap-8">
      <DashboardHomeIntro />

      <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-stretch">
        <StorageOverviewCard className="h-full" />
        <SystemHealthCard className="h-full" />
      </div>

      <DashboardSection
        title="Libraries"
        description="Default and custom libraries on this instance. Open any library to browse folders and assets."
        href="/files"
        linkLabel="All files"
      >
        <LibrarySummaryCard embedded />
      </DashboardSection>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-stretch">
        <DashboardTwinPanel
          title="Recent uploads"
          description="Sessions moving through classification and storage."
          href="/uploads"
        >
          <RecentUploadsCard embedded tall />
        </DashboardTwinPanel>

        <DashboardTwinPanel
          title="Live activity"
          description="Latest events across uploads, assets, and background jobs."
          href="/activity"
        >
          <ActivityCard embedded tall />
        </DashboardTwinPanel>
      </div>
    </div>
  )
}
