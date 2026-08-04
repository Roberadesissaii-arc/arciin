"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

import { useMusicPlayerStore } from "@/lib/stores/music-player-store"
import { cn } from "@/lib/utils"

/**
 * Shared horizontal padding for all dashboard pages (sidebar → content edge).
 * Pages must NOT add their own p-4/p-6 outer padding or spacing doubles unevenly.
 * Do not use flex-1 here — that clamps page height to the viewport and can
 * squash the intro / other natural-flow sections (chat opts into flex-1 separately).
 */
export const DASHBOARD_PAGE_PAD = "px-4 pb-14 pt-2 sm:px-5 lg:px-6 lg:pb-16"

/** Scroll wrapper for dashboard pages; chat uses a fixed column layout instead. */
export function DashboardContentArea({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isChat = pathname === "/chat" || pathname.startsWith("/chat/")
  const musicBarOpen = useMusicPlayerStore((s) => s.nowPlaying !== null)

  // Always start at the top when the route changes (avoid landing mid-page).
  useEffect(() => {
    if (isChat) return
    const root =
      (document.querySelector(
        ".dashboard-main .scrollbar-hide.overflow-y-auto",
      ) as HTMLElement | null) ||
      (document.querySelector(
        "#arciin-dashboard-workspace-host",
      )?.parentElement?.querySelector(".overflow-y-auto") as HTMLElement | null)
    if (root) {
      root.scrollTop = 0
    }
    window.scrollTo(0, 0)
  }, [pathname, isChat])

  return (
    <div
      className={cn(
        "flex flex-col",
        // Chat pins to the viewport; normal pages flow naturally so the
        // bottom padding actually lands below the content.
        isChat ? "min-h-0 flex-1 overflow-hidden" : DASHBOARD_PAGE_PAD,
      )}
    >
      <div
        id="dashboard-scaled-content"
        className={cn(
          "flex w-full min-w-0 flex-col",
          isChat ? "h-full min-h-0 flex-1 overflow-hidden" : "gap-6",
          !isChat && musicBarOpen && "pb-20",
        )}
      >
        {children}
      </div>
    </div>
  )
}
