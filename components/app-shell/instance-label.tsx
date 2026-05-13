"use client"

import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/ui/sidebar"

export function InstanceLabel({ instanceName }: { instanceName: string }) {
  const { state } = useSidebar()
  const collapsed = state === "collapsed"
  const label = instanceName.trim() || "Private instance"

  if (collapsed) {
    return null
  }

  return (
    <div className="px-2 pb-2">
      <div
        className={cn(
          "rounded-lg border border-sidebar-border/60 bg-sidebar-accent/20 px-2.5 py-2 text-left"
        )}
      >
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Instance
        </span>
        <span className="mt-0.5 block truncate text-sm font-medium text-sidebar-foreground" title={label}>
          {label}
        </span>
      </div>
    </div>
  )
}
