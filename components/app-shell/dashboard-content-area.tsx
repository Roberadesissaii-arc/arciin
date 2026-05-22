"use client"

import { usePathname } from "next/navigation"

import { useMusicPlayerStore } from "@/lib/stores/music-player-store"
import { cn } from "@/lib/utils"

/** Scroll wrapper for dashboard pages; chat uses a fixed column layout instead. */
export function DashboardContentArea({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isChat = pathname === "/chat" || pathname.startsWith("/chat/")
  const musicBarOpen = useMusicPlayerStore((s) => s.nowPlaying !== null)

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        isChat ? "overflow-hidden" : "px-3 pb-10 pt-2 sm:px-4 lg:px-5 lg:pb-12",
      )}
    >
      <div
        id="dashboard-scaled-content"
        className={cn(
          "flex w-full min-h-0 min-w-0 flex-1 flex-col",
          isChat ? "h-full overflow-hidden" : "gap-6",
          !isChat && musicBarOpen && "pb-20",
        )}
      >
        {children}
      </div>
    </div>
  )
}
