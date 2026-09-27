"use client"

import { useEffect } from "react"

/**
 * Before v1.1.0 the inbox lived in this browser's localStorage. The server is
 * the inbox now, so the old copy is deleted rather than migrated: it could not
 * be trusted (each browser had its own) and uploading it would have invented
 * history the server never recorded.
 */
const RETIRED_KEYS = ["arciin_notification_inbox", "arciin_notification_inbox_meta"]

export function RetireLocalNotificationInbox() {
  useEffect(() => {
    try {
      for (const key of RETIRED_KEYS) localStorage.removeItem(key)
    } catch {
      // Storage blocked (private mode, policy) — nothing to retire.
    }
  }, [])
  return null
}
