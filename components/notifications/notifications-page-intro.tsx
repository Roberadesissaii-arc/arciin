"use client"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { useUserPreferencesSettings } from "@/components/settings/use-user-preferences-mutation"
import { useSocketStore } from "@/lib/stores/socket-store"

export function NotificationsPageIntro() {
  const { query } = useUserPreferencesSettings()
  const prefs = query.data?.notifications
  const connected = useSocketStore((s) => s.connected)
  const anyOn = prefs
    ? prefs.uploadSound ||
      prefs.uploadCompleteToast ||
      prefs.uploadFailedToast ||
      prefs.activityFeedToast ||
      prefs.securityEventsToast
    : false

  const enabledCount = prefs
    ? [
        prefs.uploadSound,
        prefs.uploadCompleteToast,
        prefs.uploadFailedToast,
        prefs.activityFeedToast,
        prefs.securityEventsToast,
      ].filter(Boolean).length
    : 0

  return (
    <DashboardPageIntro
      title="Notifications"
      subtitle="In-browser toasts · upload sounds · live activity"
      description="Control how Arciin alerts you in this browser. Preferences are saved to your account. Toast position and style live under Settings → Appearance."
      stats={[
        {
          label: "Realtime",
          value: query.isLoading ? "…" : connected ? "Connected" : "Offline",
        },
        {
          label: "Channels on",
          value: query.isLoading ? "…" : `${enabledCount} / 5`,
        },
        {
          label: "Any enabled",
          value: query.isLoading ? "…" : anyOn ? "Yes" : "No",
        },
        {
          label: "Delivery",
          value: "Sonner toasts",
        },
      ]}
    />
  )
}
