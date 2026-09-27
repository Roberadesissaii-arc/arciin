"use client"

import Link from "next/link"
import { Bell } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { useNotificationsPage } from "@/hooks/use-notifications"

export function NotificationsPageIntro() {
  // Same query as the first inbox page, so this shares its cache entry.
  const { data } = useNotificationsPage(1, 10)
  const countLabel = data ? data.total.toLocaleString() : "…"
  const unreadLabel = data ? data.unreadCount.toLocaleString() : "…"

  return (
    <DashboardPageIntro
      title="Notifications"
      subtitle="Alert history · synced across your devices"
      cornerDecoration={<IntroCornerIcon icon={Bell} />}
      description={
        <>
          Uploads, sign-ins, and other server events for your account, with read state kept on
          the server so every device agrees. To change sounds and which toasts appear, use{" "}
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
