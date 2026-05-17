"use client"

import Link from "next/link"
import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import {
  unreadNotificationCount,
  useNotificationInboxStore,
} from "@/lib/stores/notification-inbox-store"
import { useEffect } from "react"

export function NotificationsPageIntro() {
  const hydrate = useNotificationInboxStore((s) => s.hydrate)
  const items = useNotificationInboxStore((s) => s.items)

  useEffect(() => {
    hydrate()
  }, [hydrate])

  const unread = unreadNotificationCount(items)

  return (
    <DashboardPageIntro
      title="Notifications"
      subtitle="Alert history · this browser"
      description="Alerts that appeared as toasts and live events are collected here. To change sounds and which channels fire, use notification preferences in Settings."
      stats={[
        { label: "In inbox", value: items.length.toLocaleString() },
        { label: "Unread", value: unread.toLocaleString() },
        {
          label: "Preferences",
          value: (
            <Link href="/settings?tab=notifications" className="text-primary hover:underline">
              Settings
            </Link>
          ),
        },
        { label: "Delivery", value: "Sonner toasts" },
      ]}
    />
  )
}
