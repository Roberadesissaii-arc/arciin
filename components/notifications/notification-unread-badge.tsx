"use client"

import { cn } from "@/lib/utils"
import {
  unreadNotificationCount,
  useNotificationInboxStore,
} from "@/lib/stores/notification-inbox-store"

export function NotificationUnreadBadge({
  className,
  collapsed,
}: {
  className?: string
  /** When true, show a dot instead of a number (sidebar icon mode). */
  collapsed?: boolean
}) {
  const items = useNotificationInboxStore((s) => s.items)
  const unread = unreadNotificationCount(items)

  if (unread <= 0) return null

  const label = unread > 99 ? "99+" : String(unread)

  if (collapsed) {
    return (
      <span
        className={cn(
          "absolute right-1 top-1 size-2 rounded-full bg-[#FF4F12] ring-2 ring-[#18181B]",
          className,
        )}
        aria-hidden
      />
    )
  }

  return (
    <span
      className={cn(
        "ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#FF4F12] px-1.5 text-[10px] font-bold tabular-nums leading-none text-white",
        className,
      )}
      aria-label={`${unread} unread notifications`}
    >
      {label}
    </span>
  )
}
