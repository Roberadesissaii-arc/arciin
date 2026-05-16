"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"

import { useLogout } from "@/hooks/use-auth"
import { getSecuritySettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

const ACTIVITY_EVENTS = [
  "mousedown",
  "mousemove",
  "keydown",
  "scroll",
  "touchstart",
  "click",
] as const

const CHECK_INTERVAL_MS = 15_000

export function IdleLogoutWatcher() {
  const router = useRouter()
  const logoutMutation = useLogout()
  const lastActivityRef = useRef(Date.now())
  const loggingOutRef = useRef(false)

  const settingsQuery = useQuery({
    queryKey: queryKeys.securitySettings,
    queryFn: ({ signal }) => getSecuritySettings(signal),
    staleTime: 60_000,
  })

  const idleEnabled = settingsQuery.data?.idleLogoutEnabled ?? true
  const idleMinutes = settingsQuery.data?.idleLogoutMinutes ?? 30
  const idleMs = idleMinutes * 60_000

  useEffect(() => {
    lastActivityRef.current = Date.now()
  }, [idleEnabled, idleMinutes])

  useEffect(() => {
    if (!idleEnabled || idleMs <= 0) return

    const bump = () => {
      lastActivityRef.current = Date.now()
    }

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, bump, { passive: true })
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") bump()
    }
    document.addEventListener("visibilitychange", onVisibility)

    const interval = window.setInterval(() => {
      if (document.visibilityState === "hidden") return
      if (Date.now() - lastActivityRef.current < idleMs) return
      if (loggingOutRef.current) return

      loggingOutRef.current = true
      toast.info(`Signed out after ${idleMinutes} minutes of inactivity.`)
      logoutMutation.mutate(undefined, {
        onSettled: () => {
          router.replace("/login")
          loggingOutRef.current = false
        },
      })
    }, CHECK_INTERVAL_MS)

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, bump)
      }
      document.removeEventListener("visibilitychange", onVisibility)
      window.clearInterval(interval)
    }
  }, [idleEnabled, idleMs, idleMinutes, logoutMutation, router])

  return null
}
