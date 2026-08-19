"use client"

import { cn } from "@/lib/utils"
import {
  unreadNotificationCount,
  useNotificationInboxStore,
} from "@/lib/stores/notification-inbox-store"

/**
 * Unread count on the sidebar Notifications row.
 *
 * Matches the translucent Pro pill (accent text + soft wash + thin border) —
 * not a solid orange fill that fights the dark nav.
 */
export function NotificationUnreadBadge({
  className,
  collapsed,
}: {
  className?: string
  /** When true, show a soft dot instead of a number (sidebar icon mode). */
  collapsed?: boolean
}) {
  const items = useNotificationInboxStore((s) => s.items)
  const unread = unreadNotificationCount(items)

  if (unread <= 0) return null

  const label = unread > 99 ? "99+" : String(unread)
  const pillStyle = {
    color: "var(--arciin-accent, #ff4f12)",
    background: "color-mix(in srgb, var(--arciin-accent, #ff4f12) 12%, transparent)",
    border: "1px solid color-mix(in srgb, var(--arciin-accent, #ff4f12) 28%, transparent)",
  } as const

  if (collapsed) {
    return (
      <span
        className={cn(
          "absolute right-1 top-1 size-2 rounded-full ring-2 ring-[#18181B]",
          className,
        )}
        style={{
          background: "color-mix(in srgb, var(--arciin-accent, #ff4f12) 55%, transparent)",
          boxShadow: "0 0 0 1px color-mix(in srgb, var(--arciin-accent, #ff4f12) 35%, transparent)",
        }}
        aria-hidden
      />
    )
  }

  return (
    <span
      className={cn(
        "ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1.5",
        "text-[10px] font-semibold uppercase tracking-wide tabular-nums leading-none",
        className,
      )}
      style={pillStyle}
      aria-label={`${unread} unread notifications`}
    >
      {label}
    </span>
  )
}
