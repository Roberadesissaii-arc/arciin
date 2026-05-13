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
      className="fixed top-3 left-3 z-30 h-9 w-9 rounded-xl border-white/[0.1] bg-[rgba(15,15,20,0.55)] shadow-none backdrop-blur-xl md:hidden"
      onClick={() => setOpenMobile(true)}
    >
      <Menu className="size-4" aria-hidden />
      <span className="sr-only">Open navigation</span>
    </Button>
  )
}
