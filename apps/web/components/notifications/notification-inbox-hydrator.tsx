"use client"

import { useEffect } from "react"

import { useNotificationInboxStore } from "@/lib/stores/notification-inbox-store"

/** Loads persisted inbox alerts once per dashboard session (for sidebar badge). */
export function NotificationInboxHydrator() {
  const hydrate = useNotificationInboxStore((s) => s.hydrate)

  useEffect(() => {
    hydrate()
  }, [hydrate])

  return null
}
