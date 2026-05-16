"use client"

import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

/** Scroll wrapper for dashboard pages; chat uses a fixed column layout instead. */
export function DashboardContentArea({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isChat = pathname === "/chat" || pathname.startsWith("/chat/")

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        isChat
          ? "overflow-hidden"
          : "scrollbar-hide overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-4 lg:px-5",
      )}
    >
      <div
        id="dashboard-scaled-content"
        className={cn(
          "flex w-full min-h-0 min-w-0 flex-1 flex-col",
          isChat ? "h-full overflow-hidden" : "gap-6",
        )}
      >
        {children}
      </div>
    </div>
  )
}
