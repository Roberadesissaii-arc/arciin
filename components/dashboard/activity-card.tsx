import { ActivityFeed } from "@/components/activity/activity-feed"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function ActivityCard() {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-foreground">Live activity</CardTitle>
        <CardDescription className="text-zinc-600">
          Recent events across uploads, assets, and system tasks.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActivityFeed limit={4} />
      </CardContent>
    </Card>
  )
}
