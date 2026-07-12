import { NotificationInbox } from "@/components/notifications/notification-inbox"
import { NotificationsPageIntro } from "@/components/notifications/notifications-page-intro"
import { NotificationsPageMarkRead } from "@/components/notifications/notifications-page-mark-read"

export default function NotificationsPage() {
  return (
    <div className="space-y-6 pb-8">
      <NotificationsPageMarkRead />
      <NotificationsPageIntro />
      <NotificationInbox />
    </div>
  )
}
