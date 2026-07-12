"use client"

import Link from "next/link"
import { useEffect } from "react"
import { Bell } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import {
  unreadNotificationCount,
  useNotificationInboxStore,
} from "@/lib/stores/notification-inbox-store"

export function NotificationsPageIntro() {
  const hydrate = useNotificationInboxStore((s) => s.hydrate)
  const hydrated = useNotificationInboxStore((s) => s.hydrated)
  const items = useNotificationInboxStore((s) => s.items)

  useEffect(() => {
    hydrate()
  }, [hydrate])

  const unread = unreadNotificationCount(items)
  const countLabel = hydrated ? items.length.toLocaleString() : "…"
  const unreadLabel = hydrated ? unread.toLocaleString() : "…"

  return (
    <DashboardPageIntro
      title="Notifications"
      subtitle="Alert history · this browser"
      cornerDecoration={<IntroCornerIcon icon={Bell} />}
      description={
        <>
          Alerts that appeared as toasts and live events are collected here. To change sounds and
          which channels fire, use{" "}
          <Link href="/settings?tab=notifications" className="font-medium text-primary hover:underline">
            notification preferences in Settings
          </Link>
          .
        </>
      }
      stats={[
        { label: "In inbox", value: countLabel },
        { label: "Unread", value: unreadLabel },
        { label: "Preferences", value: "Settings" },
        { label: "Delivery", value: "Sonner toasts" },
      ]}
    />
  )
}
