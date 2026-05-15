"use client"

import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"

import { getUserPreferences } from "@/lib/api/user-preferences"
import { queryKeys } from "@/lib/api/query-keys"
import { applyUserPreferences } from "@/lib/preferences/apply-user-preferences"
import { setNotificationPreferences } from "@/lib/preferences/notification-policy"

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: queryKeys.userPreferences,
    queryFn: ({ signal }) => getUserPreferences(signal),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!data) return
    applyUserPreferences(data)
    setNotificationPreferences(data.notifications)
  }, [data])

  useEffect(() => {
    if (!data) return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onChange = () => applyUserPreferences(data)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [data])

  return children
}
