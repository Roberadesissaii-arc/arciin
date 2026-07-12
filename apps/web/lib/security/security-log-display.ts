import type { ActivitySummary } from "@/lib/types/models"

/** True when the IP column can drive allow/block actions. */
export function securityLogActionableIp(ip: string | null | undefined): ip is string {
  if (!ip?.trim() || ip === "unknown") return false
  const trimmed = ip.trim()
  if (/^(?:(?:\d{1,3}\.){3}\d{1,3})(?:\/\d{1,2})?$/.test(trimmed)) return true
  if (/^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i.test(trimmed)) return true
  return false
}

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

/** Device label from metadata or message (e.g. Safari on iPadOS). */
export function securityLogDeviceLabel(event: ActivitySummary): string | null {
  const meta = event.metadata
  if (meta && typeof meta.deviceLabel === "string" && meta.deviceLabel.trim()) {
    return meta.deviceLabel.trim()
  }

  const message = event.message ?? ""
  const deviceMatch = message.match(/\(([^)]+)\)\.\s*$/)
  if (deviceMatch?.[1]) return deviceMatch[1].trim()

  return null
}

/** Event text without redundant IP / device details (those have their own columns). */
export function securityLogEventLabel(event: ActivitySummary): string {
  const type = event.type
  const raw = securityLogSummary(event)

  if (type === "security.ip_denied") {
    const reasonMatch = raw.match(/\(([^)]+)\)/)
    const reason = reasonMatch?.[1] ?? "policy"
    return `Request blocked (${reason}).`
  }

  if (type === "security.rate_limited") {
    const reasonMatch = raw.match(/exceeded\s+(\d+)\s+requests\/min/i)
    if (reasonMatch?.[1]) {
      return `Rate limit exceeded (${reasonMatch[1]}/min).`
    }
    return "Rate limit exceeded."
  }

  if (type.startsWith("security.ip_blocklist") || type.startsWith("security.ip_allowlist")) {
    return raw
      .replace(
        /\b(\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?|(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4})\b/gi,
        "this address",
      )
      .replace(/\bthis address this address\b/gi, "this address")
  }

  return raw
    .replace(
      /\s+from\s+(?:(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?|(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4})(?:\s+\([^)]+\))?\.\s*$/i,
      ".",
    )
    .replace(/\s+\([^)]+\)\.\s*$/, ".")
    .trim()
}

/** Build IP → device map from loaded security log rows (oldest known device wins). */
export function buildSecurityLogDeviceMap(events: ActivitySummary[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const event of [...events].reverse()) {
    const ip = securityLogClientIp(event)
    const device = securityLogDeviceLabel(event)
    if (ip && device && !map.has(ip)) {
      map.set(ip, device)
    }
  }
  return map
}

export function securityLogDeviceLabelForEvent(
  event: ActivitySummary,
  deviceByIp?: Map<string, string>,
): string | null {
  const direct = securityLogDeviceLabel(event)
  if (direct) return direct
  const ip = securityLogClientIp(event)
  if (!ip || !deviceByIp) return null
  return deviceByIp.get(ip) ?? null
}
