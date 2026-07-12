import {
  useNotificationInboxStore,
  type InboxNotificationVariant,
} from "@/lib/stores/notification-inbox-store"

/** Append a toast-style alert to the in-app notification inbox (this browser). */
export function recordInboxNotification(input: {
  id?: string
  title: string
  message?: string
  variant?: InboxNotificationVariant
  source?: "upload" | "activity" | "security" | "system"
  read?: boolean
}) {
  useNotificationInboxStore.getState().push(input)
}
