"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const isIndeterminate = value == null || Number.isNaN(value as number)
  const pct = isIndeterminate
    ? 0
    : Math.min(100, Math.max(0, Number(value)))

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "group relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]",
        className
      )}
      {...props}
      value={isIndeterminate ? null : pct}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full rounded-full bg-gradient-to-r from-[#FF4F12] to-[#FF6A33] transition-[width] duration-500 ease-out",
          "group-data-[state=indeterminate]:w-[42%] group-data-[state=indeterminate]:max-w-[45%] group-data-[state=indeterminate]:animate-pulse"
        )}
        style={isIndeterminate ? undefined : { width: `${pct}%` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
