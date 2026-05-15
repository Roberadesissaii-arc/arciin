import { ActivityCard } from "@/components/dashboard/activity-card"
import { LibrarySummaryCard } from "@/components/dashboard/library-summary-card"
import { QuickAccessCard } from "@/components/dashboard/quick-access-card"
import { RecentUploadsCard } from "@/components/dashboard/recent-uploads-card"
import { StorageOverviewCard } from "@/components/dashboard/storage-overview-card"
import { SystemHealthCard } from "@/components/dashboard/system-health-card"
import { MobileDashboard } from "@/components/mobile/dashboard/mobile-dashboard"

export default function DashboardPage() {
  return (
    <>
      {/* Mobile layout — shown by the MobileShell in layout.tsx */}
      <div className="md:hidden">
        <MobileDashboard />
      </div>

      {/* Desktop layout */}
      <div className="hidden md:grid md:gap-6">
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <StorageOverviewCard />
          <SystemHealthCard />
        </div>
        <LibrarySummaryCard />
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <RecentUploadsCard />
          <QuickAccessCard />
        </div>
        <ActivityCard />
      </div>
    </>
  )
}
