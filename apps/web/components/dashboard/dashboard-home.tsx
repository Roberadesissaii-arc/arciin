"use client"

import Link from "next/link"
import { ChevronRight } from "lucide-react"

import { DashboardHomeIntro } from "@/components/dashboard/dashboard-home-intro"
import { RecentUploadsPanel } from "@/components/dashboard/recent-uploads-panel"
import { StorageDonutCard } from "@/components/dashboard/storage-donut-card"
import { SystemStatusSection } from "@/components/dashboard/system-status-section"
import { BrowserSectionHeading } from "@/components/libraries/browser-section-heading"

export function DashboardHome() {
  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <DashboardHomeIntro />

      <section className="space-y-3">
        <BrowserSectionHeading>Storage</BrowserSectionHeading>
        <StorageDonutCard />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200/90 pb-2">
          <BrowserSectionHeading className="w-auto border-0 pb-0">
            Recent uploads
          </BrowserSectionHeading>
          <Link
            href="/files"
            className="inline-flex shrink-0 items-center gap-0.5 rounded-lg px-2 py-1 text-sm font-medium text-primary transition-colors hover:bg-[var(--arciin-accent-badge-bg)] hover:text-primary"
          >
            View all
            <ChevronRight className="size-4" />
          </Link>
        </div>
        <RecentUploadsPanel />
      </section>

      <section className="space-y-3">
        <BrowserSectionHeading>System</BrowserSectionHeading>
        <SystemStatusSection />
      </section>
    </div>
  )
}
