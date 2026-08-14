"use client"

import { DashboardHomeIntro } from "@/components/dashboard/dashboard-home-intro"
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header"
import { RecentUploadsPanel } from "@/components/dashboard/recent-uploads-panel"
import { StorageDonutCard } from "@/components/dashboard/storage-donut-card"
import { SystemStatusSection } from "@/components/dashboard/system-status-section"

/**
 * Every section is the same shape: an underlined heading, an optional link on
 * that row, then one container. Recent uploads sat bare on the page between two
 * carded sections, which made it read as loose content rather than a section.
 */
export function DashboardHome() {
  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <DashboardHomeIntro />

      <section className="space-y-3">
        <DashboardSectionHeader>Storage</DashboardSectionHeader>
        <StorageDonutCard />
      </section>

      <section className="space-y-3">
        <DashboardSectionHeader href="/files" action="View all">
          Recent uploads
        </DashboardSectionHeader>
        <div className="overflow-hidden rounded-[2rem] border border-zinc-200/90 bg-white p-4 sm:p-5">
          <RecentUploadsPanel />
        </div>
      </section>

      <section className="space-y-3">
        <DashboardSectionHeader href="/jobs" action="Background jobs">
          System
        </DashboardSectionHeader>
        <SystemStatusSection />
      </section>
    </div>
  )
}
