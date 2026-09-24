"use client"

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"

import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationsPage,
} from "@/lib/api/notifications"
import { queryKeys } from "@/lib/api/query-keys"

/**
 * The server is the only inbox.
 *
 * Every tab and device reads the same list and the same unread count. Nothing
 * here is persisted locally: a socket `notifications.read` or `activity.*`
 * event invalidates the prefix, and each tab refetches.
 */

const BADGE_PARAMS = { limit: 1, offset: 0 }

export function useNotificationsPage(page: number, pageSize: number) {
  const params = { limit: pageSize, offset: Math.max(0, page - 1) * pageSize }
  return useQuery({
    queryKey: queryKeys.notifications(params),
    queryFn: ({ signal }) => getNotifications(params, signal),
    placeholderData: (previous) => previous,
  })
}

/** Sidebar badge. Cheap: one row, plus the whole-inbox count. */
export function useNotificationUnreadCount() {
  const query = useQuery({
    queryKey: queryKeys.notifications(BADGE_PARAMS),
    queryFn: ({ signal }) => getNotifications(BADGE_PARAMS, signal),
    // A tab left in the background still converges if a socket drop loses an event.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  return query.data?.unreadCount ?? 0
}

function patchEveryPage(
  queryClient: QueryClient,
  update: (page: NotificationsPage) => NotificationsPage,
) {
  queryClient.setQueriesData<NotificationsPage>(
    { queryKey: queryKeys.notificationsRoot },
    (current) => (current ? update(current) : current),
  )
}

async function optimistic(queryClient: QueryClient, update: (page: NotificationsPage) => NotificationsPage) {
  await queryClient.cancelQueries({ queryKey: queryKeys.notificationsRoot })
  const snapshot = queryClient.getQueriesData<NotificationsPage>({
    queryKey: queryKeys.notificationsRoot,
  })
  patchEveryPage(queryClient, update)
  return { snapshot }
}

function rollback(queryClient: QueryClient, context?: { snapshot: Array<[readonly unknown[], NotificationsPage | undefined]> }) {
  for (const [key, data] of context?.snapshot ?? []) {
    queryClient.setQueryData(key, data)
  }
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: (id) =>
      optimistic(queryClient, (page) => {
        const wasUnread = page.items.some((item) => item.id === id && !item.read)
        return {
          ...page,
          items: page.items.map((item) => (item.id === id ? { ...item, read: true } : item)),
          unreadCount: wasUnread ? Math.max(0, page.unreadCount - 1) : page.unreadCount,
        }
      }),
    onError: (_error, _id, context) => rollback(queryClient, context),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot }),
  })
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onMutate: () =>
      optimistic(queryClient, (page) => ({
        ...page,
        items: page.items.map((item) => ({ ...item, read: true })),
        unreadCount: 0,
      })),
    onError: (_error, _vars, context) => rollback(queryClient, context),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.notificationsRoot }),
  })
}
