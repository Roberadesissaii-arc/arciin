"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useLogout } from "@/hooks/use-auth"
import { getSecuritySettings } from "@/lib/api/settings"
import { clearPendingWelcomeToast, isRememberMeActive } from "@/lib/auth/login-remember"
import { decideIdleLogout } from "@/lib/auth/idle-policy"
import { hasActiveBackgroundAITask } from "@/lib/tasks/ai-tasks"
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
  const lastActivityRef = useRef(0)
  const loggingOutRef = useRef(false)
  /** So the deferral is logged once per hold, not once per tick. */
  const deferredRef = useRef(false)

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
    if (isRememberMeActive()) return

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
      if (loggingOutRef.current) return

      /**
       * `lastActivityRef` is never touched here.
       *
       * That is the whole point: a running book defers the sign-out, it does
       * not refresh the reader's idle window. When the book stops, the clock is
       * already long past the threshold and the very next tick signs out — at
       * most `CHECK_INTERVAL_MS` later, with no fresh grace period.
       */
      const decision = decideIdleLogout({
        idleEnabled,
        idleMs,
        msSinceActivity: Date.now() - lastActivityRef.current,
        backgroundTaskRunning: hasActiveBackgroundAITask(),
      })

      if (decision === "wait") {
        // Back inside the window — the reader returned, or the settings
        // changed. The next hold is a new one and gets its own line.
        deferredRef.current = false
        return
      }

      if (decision === "defer") {
        if (!deferredRef.current) {
          deferredRef.current = true
          // Said once per hold, not every fifteen seconds. A session that
          // outlived its idle timeout should be explicable afterwards.
          console.info("[idle] sign-out deferred: an AI task is still running")
        }
        return
      }

      deferredRef.current = false

      loggingOutRef.current = true
      clearPendingWelcomeToast()
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
