import { redirect } from "next/navigation"

/** Notification preferences live under Settings → Personalization. */
export default function NotificationsPage() {
  redirect("/settings?tab=notifications")
}
