"use client"

import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/ui/sidebar"

export function SidebarFooterCollapse() {
  const { toggleSidebar, state, isMobile } = useSidebar()

  if (isMobile) {
    return null
  }

  const collapsed = state === "collapsed"

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      className={cn(
        "flex h-8 w-full items-center rounded-lg px-2 text-[11px] text-[rgba(255,255,255,0.28)] transition-colors hover:bg-white/[0.04] hover:text-[rgba(255,255,255,0.55)]",
        collapsed ? "justify-center" : "justify-end gap-1"
      )}
    >
      {collapsed ? (
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <>
          <span>Collapse</span>
          <ChevronLeft className="size-3.5 shrink-0" aria-hidden />
        </>
      )}
    </button>
  )
}
