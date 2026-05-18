"use client"

import { useEffect } from "react"

import { useNotificationInboxStore } from "@/lib/stores/notification-inbox-store"

/** Clears the sidebar badge when the user opens the notifications page. */
export function NotificationsPageMarkRead() {
  useEffect(() => {
    const { hydrate, markAllRead } = useNotificationInboxStore.getState()
    hydrate()
    markAllRead()
  }, [])

  return null
}
