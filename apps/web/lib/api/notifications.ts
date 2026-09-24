import { fetchApi } from "@/lib/api/client"

export type NotificationVariant = "default" | "success" | "error" | "warning"
export type NotificationSource = "upload" | "activity" | "security"

export type NotificationItem = {
  id: string
  title: string
  message?: string
  variant: NotificationVariant
  source: NotificationSource
  createdAt: string
  read: boolean
  metadata: Record<string, unknown> | null
}

export type NotificationsPage = {
  items: NotificationItem[]
  /** Across the whole inbox, not just this page. */
  unreadCount: number
  total: number
}

export function getNotifications(
  params: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
) {
  const search = new URLSearchParams()
  if (params.limit != null) search.set("limit", String(params.limit))
  if (params.offset != null) search.set("offset", String(params.offset))
  const qs = search.toString()
  return fetchApi<NotificationsPage>(`/notifications${qs ? `?${qs}` : ""}`, {
    method: "GET",
    signal,
  })
}

export function markNotificationRead(id: string) {
  return fetchApi<{ read: true }>(`/notifications/${encodeURIComponent(id)}/read`, {
    method: "PATCH",
  })
}

export function markAllNotificationsRead() {
  return fetchApi<{ unreadCount: 0 }>("/notifications/mark-all-read", { method: "POST" })
}
