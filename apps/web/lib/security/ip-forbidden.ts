export type IpForbiddenReason = "blocked" | "allowlist" | "allowlist_empty"

export function resolveIpForbiddenReason(message?: string): IpForbiddenReason {
  if (!message) return "blocked"
  if (message.includes("not on the allowlist")) return "allowlist"
  if (message.includes("allowlist enforcement")) return "allowlist_empty"
  return "blocked"
}

export function ipForbiddenScreenCopy(reason: IpForbiddenReason) {
  switch (reason) {
    case "blocked":
      return {
        title: "This network cannot reach Arciin.",
        description:
          "Your connection was blocked by this instance's security policy. Sign-in and API access from this device or network are not permitted.",
      }
    case "allowlist":
      return {
        title: "This network is not approved.",
        description:
          "Only allowlisted IP addresses can reach this Arciin instance. Your current connection is not on the list.",
      }
    case "allowlist_empty":
      return {
        title: "Access is restricted right now.",
        description:
          "IP allowlist enforcement is enabled, but no addresses are configured yet. An administrator must add approved networks before anyone can connect.",
      }
  }
}

/** Friendlier copy for realtime security toasts (e.g. `192.168.4.50 denied (blocklist) on /api/activity.`). */
export function formatSecurityIpToastDescription(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined

  const match = raw.trim().match(/request blocked \(([^)]+)\)/i)
  if (match) {
    const reason = match[1]
    const label =
      reason === "blocklist"
        ? "blocked"
        : reason === "not on allowlist"
          ? "not allowlisted"
          : reason === "allowlist empty"
            ? "denied while allowlist is empty"
            : reason
    return `Request was ${label} from this instance.`
  }

  const legacy = raw.trim().match(/^([\da-f:.]+(?:\/\d+)?)\s+denied\s+\(([^)]+)\)/i)
  if (!legacy) return raw.trim()

  const [, , reason] = legacy
  const label =
    reason === "blocklist"
      ? "blocked"
      : reason === "not on allowlist"
        ? "not allowlisted"
        : reason === "allowlist empty"
          ? "denied while allowlist is empty"
          : reason

  return `Request was ${label} from this instance.`
}
