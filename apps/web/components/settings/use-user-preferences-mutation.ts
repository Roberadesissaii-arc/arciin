"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "@/lib/notifications/arciin-toast"
import {
  DEFAULT_USER_PREFERENCES,
  mergeUserPreferences,
  type UserPreferences,
} from "@arciin/shared"

import { getUserPreferences, updateUserPreferences } from "@/lib/api/user-preferences"
import { queryKeys } from "@/lib/api/query-keys"
import { applyUserPreferences } from "@/lib/preferences/apply-user-preferences"
import { setNotificationPreferences } from "@/lib/preferences/notification-policy"

function commitPreferences(
  queryClient: ReturnType<typeof useQueryClient>,
  next: UserPreferences,
) {
  applyUserPreferences(next)
  setNotificationPreferences(next.notifications)
  queryClient.setQueryData(queryKeys.userPreferences, next)
}

export function useUserPreferencesSettings() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: queryKeys.userPreferences,
    queryFn: ({ signal }) => getUserPreferences(signal),
  })

  const mutation = useMutation({
    mutationFn: updateUserPreferences,
    onSuccess: (data) => {
      commitPreferences(queryClient, data)
    },
    onError: (error) => {
      toast.error("Could not save preference", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      })
    },
  })

  function patch(
    partial: Partial<{
      notifications: Partial<UserPreferences["notifications"]>
      appearance: Partial<UserPreferences["appearance"]>
      accessibility: Partial<UserPreferences["accessibility"]>
      media: Partial<UserPreferences["media"]>
    }>,
    successLabel?: string,
    successDescription?: string,
  ) {
    const current = query.data ?? DEFAULT_USER_PREFERENCES
    const optimistic = mergeUserPreferences(current, partial)
    const previous = current

    commitPreferences(queryClient, optimistic)

    mutation.mutate(partial, {
      onSuccess: () => {
        if (successLabel) {
          toast.success(successLabel, {
            description: successDescription ?? "Your preference is saved and applied across the app.",
          })
        }
      },
      onError: () => {
        commitPreferences(queryClient, previous)
      },
    })
  }

  return { query, mutation, patch }
}
