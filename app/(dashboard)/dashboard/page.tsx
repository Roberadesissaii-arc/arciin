import { ActivityCard } from "@/components/dashboard/activity-card"
import { LibrarySummaryCard } from "@/components/dashboard/library-summary-card"
import { QuickAccessCard } from "@/components/dashboard/quick-access-card"
import { RecentUploadsCard } from "@/components/dashboard/recent-uploads-card"
import { StorageOverviewCard } from "@/components/dashboard/storage-overview-card"
import { SystemHealthCard } from "@/components/dashboard/system-health-card"

export default function DashboardPage() {
  return (
    <div className="grid gap-6">
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
  )
}
