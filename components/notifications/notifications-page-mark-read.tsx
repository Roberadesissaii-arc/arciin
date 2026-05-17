"use client"

import { useEffect } from "react"

import { useNotificationInboxStore } from "@/lib/stores/notification-inbox-store"

/** Clears the sidebar badge when the user opens the notifications page. */
export function NotificationsPageMarkRead() {
  const markAllRead = useNotificationInboxStore((s) => s.markAllRead)

  useEffect(() => {
    markAllRead()
  }, [markAllRead])

  return null
}
