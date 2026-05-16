import { NotificationsPageIntro } from "@/components/notifications/notifications-page-intro"
import { NotificationsSettingsPanel } from "@/components/settings/notifications-settings-panel"

export default function NotificationsPage() {
  return (
    <div className="space-y-6 pb-8">
      <NotificationsPageIntro />
      <NotificationsSettingsPanel />
    </div>
  )
}
