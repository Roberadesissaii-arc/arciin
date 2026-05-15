"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
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
      toast.error(
        error instanceof Error ? error.message : "Could not save preference.",
      )
    },
  })

  function patch(
    partial: Partial<{
      notifications: Partial<UserPreferences["notifications"]>
      appearance: Partial<UserPreferences["appearance"]>
      accessibility: Partial<UserPreferences["accessibility"]>
    }>,
    successLabel?: string,
  ) {
    const current = query.data ?? DEFAULT_USER_PREFERENCES
    const optimistic = mergeUserPreferences(current, partial)
    const previous = current

    commitPreferences(queryClient, optimistic)

    mutation.mutate(partial, {
      onSuccess: () => {
        if (successLabel) toast.success(successLabel)
      },
      onError: () => {
        commitPreferences(queryClient, previous)
      },
    })
  }

  return { query, mutation, patch }
}
