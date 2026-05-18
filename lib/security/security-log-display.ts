import type { ActivitySummary } from "@/lib/types/models"

export function securityLogClientIp(event: ActivitySummary): string | null {
  const meta = event.metadata
  if (meta && typeof meta.clientIp === "string" && meta.clientIp.trim()) {
    return meta.clientIp.trim()
  }

  const message = event.message ?? ""
  const fromMatch = message.match(/\bfrom\s+(\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?)\b/i)
  if (fromMatch?.[1]) return fromMatch[1]

  const blockedMatch = message.match(/\b(\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?)\s+was\b/i)
  if (blockedMatch?.[1]) return blockedMatch[1]

  return null
}

export function securityLogStatus(event: ActivitySummary): {
  label: string
  tone: "good" | "bad" | "warn" | "muted"
} {
  const type = event.type
  const metaStatus =
    event.metadata && typeof event.metadata.status === "string"
      ? event.metadata.status
      : null

  if (type === "security.ip_denied") {
    return { label: "Blocked", tone: "bad" }
  }
  if (type === "security.rate_limited") {
    return { label: "Rate limited", tone: "warn" }
  }
  if (type.startsWith("auth.login_failed")) {
    return { label: "Denied", tone: "bad" }
  }
  if (type === "auth.login" || type === "auth.register") {
    return { label: "OK", tone: "good" }
  }
  if (type.startsWith("security.ip_blocklist") || type.startsWith("security.ip_allowlist")) {
    return { label: "Policy", tone: "muted" }
  }
  if (type === "auth.sessions_revoked" || type === "security.password_changed") {
    return { label: "Action", tone: "warn" }
  }
  if (metaStatus === "policy") {
    return { label: "Policy", tone: "muted" }
  }

  if (type.includes("failed") || type.includes("denied") || type.includes("revoked")) {
    return { label: "Alert", tone: "bad" }
  }

  return { label: "Event", tone: "muted" }
}

/** One-line summary for the security log table (message preferred over title). */
export function securityLogSummary(event: { title: string; message?: string | null }): string {
  const message = event.message?.trim()
  if (message) return message
  return event.title.trim()
}
