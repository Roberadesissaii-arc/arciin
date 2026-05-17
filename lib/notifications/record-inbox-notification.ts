import {
  useNotificationInboxStore,
  type InboxNotificationVariant,
} from "@/lib/stores/notification-inbox-store"

/** Append a toast-style alert to the in-app notification inbox (this browser). */
export function recordInboxNotification(input: {
  title: string
  message?: string
  variant?: InboxNotificationVariant
  source?: "upload" | "activity" | "security" | "system"
}) {
  useNotificationInboxStore.getState().push(input)
}
