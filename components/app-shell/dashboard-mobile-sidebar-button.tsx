"use client"

import { Menu } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"

export function DashboardMobileSidebarButton() {
  const { isMobile, setOpenMobile } = useSidebar()

  if (!isMobile) {
    return null
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="fixed top-3 left-3 z-30 h-9 w-9 rounded-xl border-border bg-background/95 shadow-sm ring-1 ring-black/[0.04] backdrop-blur-xl md:hidden"
      onClick={() => setOpenMobile(true)}
    >
      <Menu className="size-4" aria-hidden />
      <span className="sr-only">Open navigation</span>
    </Button>
  )
}
