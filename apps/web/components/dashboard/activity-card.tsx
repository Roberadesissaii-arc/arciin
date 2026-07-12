"use client"

import { ActivityFeed } from "@/components/activity/activity-feed"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function ActivityCard({
  embedded = false,
  tall = false,
  fill = false,
  limit = 6,
  className,
}: {
  embedded?: boolean
  tall?: boolean
  /** Stretch the list box to the parent height (no internal scrolling). */
  fill?: boolean
  limit?: number
  className?: string
}) {
  const feed = (
    <div
      className={cn(
        tall && "flex min-h-0 flex-1 flex-col",
        fill && "min-h-0 flex-1",
      )}
    >
      <ActivityFeed limit={limit} tall={tall} dashboard />
    </div>
  )

  if (embedded) {
    return (
      <div
        className={cn(
          (tall || fill) && "flex h-full min-h-0 flex-1 flex-col",
          className,
        )}
      >
        {feed}
      </div>
    )
  }

  return (
    <Card className={cn("border-border bg-card shadow-sm", className)}>
      <CardContent className="pt-6">{feed}</CardContent>
    </Card>
  )
}
