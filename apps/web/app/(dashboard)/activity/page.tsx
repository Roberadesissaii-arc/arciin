import { ActivityFeed } from "@/components/activity/activity-feed"
import { ActivityPageIntro } from "@/components/activity/activity-page-intro"

export default function ActivityPage() {
  return (
    <div className="space-y-5 pb-6">
      <ActivityPageIntro />
      <ActivityFeed />
    </div>
  )
}
