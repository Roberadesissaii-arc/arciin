"use client"

import { useQuery } from "@tanstack/react-query"
import { DEFAULT_USER_PREFERENCES } from "@arciin/shared"

import { Toaster } from "@/components/ui/sonner"
import { getUserPreferences } from "@/lib/api/user-preferences"
import { queryKeys } from "@/lib/api/query-keys"

export function AppearanceToaster() {
  const { data } = useQuery({
    queryKey: queryKeys.userPreferences,
    queryFn: ({ signal }) => getUserPreferences(signal),
    staleTime: 60_000,
  })

  const appearance = data?.appearance ?? DEFAULT_USER_PREFERENCES.appearance

  return (
    <Toaster
      key={`${appearance.toastPosition}-${appearance.toastStyle}-${appearance.toastShowIcons}`}
      position={appearance.toastPosition}
      toastStyle={appearance.toastStyle}
      showIcons={appearance.toastShowIcons}
    />
  )
}
