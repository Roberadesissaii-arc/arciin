"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { SidebarProvider } from "@/components/ui/sidebar"
import { queryKeys } from "@/lib/api/query-keys"
import { getUserPreferences, updateUserPreferences } from "@/lib/api/user-preferences"
import type { UserPreferences } from "@arciin/shared"

/**
 * The dashboard sidebar, remembered through the user's saved preferences.
 *
 * `appearance.sidebarCollapsed` is the source of truth, so the choice follows
 * the account across reloads, browsers, and sign-ins. The provider's cookie is
 * kept only as a first-paint hint so a reload does not flash the wrong state
 * while preferences load.
 */
export function PersistedSidebarProvider({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: queryKeys.userPreferences,
    queryFn: ({ signal }) => getUserPreferences(signal),
    staleTime: 60_000,
  })

  const save = useMutation({
    mutationFn: (collapsed: boolean) =>
      updateUserPreferences({ appearance: { sidebarCollapsed: collapsed } }),
    onMutate: (collapsed) => {
      queryClient.setQueryData<UserPreferences>(queryKeys.userPreferences, (current) =>
        current ? { ...current, appearance: { ...current.appearance, sidebarCollapsed: collapsed } } : current,
      )
    },
    onSuccess: (next) => queryClient.setQueryData(queryKeys.userPreferences, next),
  })

  const preferredOpen = data ? !data.appearance.sidebarCollapsed : null

  return (
    <SidebarProvider
      defaultOpen
      preferredOpen={preferredOpen}
      onPreferredOpenChange={(open) => save.mutate(!open)}
      className={className}
    >
      {children}
    </SidebarProvider>
  )
}
