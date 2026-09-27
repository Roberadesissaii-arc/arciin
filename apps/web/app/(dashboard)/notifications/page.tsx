import { NotificationInbox } from "@/components/notifications/notification-inbox"
import { NotificationsPageIntro } from "@/components/notifications/notifications-page-intro"

export default function NotificationsPage() {
  return (
    <div className="space-y-6 pb-8">
      <NotificationsPageIntro />
      <NotificationInbox />
    </div>
  )
}
