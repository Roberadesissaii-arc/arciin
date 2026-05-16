"use client"

import { ActivityFeed } from "@/components/activity/activity-feed"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function ActivityCard({
  embedded = false,
  tall = false,
  className,
}: {
  embedded?: boolean
  tall?: boolean
  className?: string
}) {
  const feed = (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card",
        tall && "flex min-h-0 flex-1 flex-col",
      )}
    >
      <ActivityFeed limit={6} tall={tall} />
    </div>
  )

  if (embedded) {
    return <div className={cn(tall && "flex min-h-0 flex-1 flex-col", className)}>{feed}</div>
  }

  return (
    <Card className={cn("border-border bg-card shadow-sm", className)}>
      <CardContent className="pt-6">{feed}</CardContent>
    </Card>
  )
}
