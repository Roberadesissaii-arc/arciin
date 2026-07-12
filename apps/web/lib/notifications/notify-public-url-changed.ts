import { toast } from "@/lib/notifications/arciin-toast"

import { queryKeys } from "@/lib/api/query-keys"
import type { QueryClient } from "@tanstack/react-query"

import { recordInboxNotification } from "./record-inbox-notification"

export function publicUrlHostLabel(url: string): string {
  const raw = url.trim().replace(/\/+$/, "")
  if (!raw) return url
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return parsed.hostname
  } catch {
    return raw
  }
}

export function notifyPublicUrlChanged(
  input: { newUrl: string; previousUrl?: string | null },
  queryClient?: QueryClient,
) {
  const previous = input.previousUrl?.trim().replace(/\/+$/, "") ?? ""
  const next = input.newUrl.trim().replace(/\/+$/, "")
  if (!previous || !next || previous === next) return

  const newHost = publicUrlHostLabel(next)
  const title = "Public URL changed"
  const message = `Your free Cloudflare tunnel restarted. New address: ${newHost}. Update bookmarks and reopen the mobile app if you are away from home Wi‑Fi.`

  recordInboxNotification({
    title,
    message,
    variant: "warning",
    source: "system",
  })
  toast.warning(title, {
    description: message,
    duration: 14_000,
  })

  queryClient?.invalidateQueries({ queryKey: queryKeys.remoteAccessSettings })
  queryClient?.invalidateQueries({ queryKey: queryKeys.cloudflareTunnel })
  queryClient?.invalidateQueries({ queryKey: queryKeys.activityRoot })
}
