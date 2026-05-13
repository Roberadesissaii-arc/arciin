"use client"

import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/ui/sidebar"

export function SidebarBrand() {
  const { state } = useSidebar()
  const collapsed = state === "collapsed"

  return (
    <div
      role="group"
      aria-label="Arciin"
      className={cn(
        "flex h-14 shrink-0 items-center border-b border-sidebar-border/60 px-4",
        collapsed && "justify-center px-0"
      )}
    >
      {collapsed ? (
        <span className="font-heading text-base font-bold leading-none text-[#FF4F12]">A</span>
      ) : (
        <p className="font-heading text-[17px] font-bold leading-none tracking-tight text-sidebar-foreground">
          Arciin<span className="text-[#FF4F12]">.</span>
        </p>
      )}
    </div>
  )
}
