"use client"

import { useEffect } from "react"

import { consumeWelcomeToast } from "@/lib/auth/login-remember"
import { notifyWelcomeBack } from "@/lib/notifications/toast-actions"

/** Fires the styled welcome toast once after sign-in, when the dashboard shell mounts. */
export function LoginWelcomeToast() {
  useEffect(() => {
    if (!consumeWelcomeToast()) return

    const timer = window.setTimeout(() => {
      notifyWelcomeBack()
    }, 120)

    return () => window.clearTimeout(timer)
  }, [])

  return null
}
