"use client"

import { ActivityFeed } from "@/components/activity/activity-feed"
import { ActivityHero } from "@/components/activity/activity-hero"

export default function ActivityPage() {
  return (
    <div className="space-y-5 pb-6">
      <ActivityHero />
      <ActivityFeed />
    </div>
  )
}
