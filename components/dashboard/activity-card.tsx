import { ActivityFeed } from "@/components/activity/activity-feed"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function ActivityCard() {
  return (
    <Card className="border-white/8 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-white">Live activity</CardTitle>
        <CardDescription className="text-zinc-400">
          Recent events across uploads, assets, and system tasks.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActivityFeed limit={4} />
      </CardContent>
    </Card>
  )
}
