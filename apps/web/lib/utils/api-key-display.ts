import { formatRelativeDate } from "@/lib/utils/format-date"

/**
 * The words the API key table shows for a key's limits. Presentation only:
 * the values come straight from the API and nothing here changes them.
 */

/** "600 req/min" or "No rate limit" — short enough for the Prefix column. */
export function apiKeyRateLimitLabel(rateLimitPerMinute: number | null | undefined): string {
  return rateLimitPerMinute ? `${rateLimitPerMinute.toLocaleString("en-US")} req/min` : "No rate limit"
}

/**
 * "Expires in 3 months", "Expires tomorrow", "Expired 2 days ago" or
 * "No expiration". A key that never expires is a standing credential, and
 * showing that is the point — it is flagged, not hidden.
 */
export function apiKeyExpiryLabel(
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): { text: string; tone: "muted" | "warning" } {
  if (!expiresAt) return { text: "No expiration", tone: "warning" }
  const at = new Date(expiresAt)
  if (Number.isNaN(at.getTime())) return { text: "No expiration", tone: "warning" }
  const ms = at.getTime() - now.getTime()
  if (ms <= 0) return { text: `Expired ${formatRelativeDate(at)}`, tone: "warning" }
  if (ms < 36 * 60 * 60 * 1000 && at.getDate() !== now.getDate()) return { text: "Expires tomorrow", tone: "muted" }
  if (ms < 24 * 60 * 60 * 1000) return { text: "Expires today", tone: "muted" }
  return { text: `Expires ${formatRelativeDate(at)}`, tone: "muted" }
}

export function apiKeyLastUsedLabel(lastUsedAt: string | null | undefined): string {
  return lastUsedAt ? formatRelativeDate(lastUsedAt) : "Never"
}

/**
 * Row actions. Rotate is a solid, neutral action — dark, not the orange
 * primary CTA and never red; Revoke is the solid destructive one. Same
 * height, width and icon size, so the column lines up down the list.
 */
export const API_KEY_ACTION_BASE = "h-8 w-[104px] justify-center gap-1.5 [&_svg]:size-4"
export const API_KEY_ROTATE_CLASS =
  "border border-zinc-900 bg-zinc-900 text-white shadow-sm hover:border-zinc-700 hover:bg-zinc-700 hover:text-white disabled:border-zinc-300 disabled:bg-zinc-300 disabled:text-zinc-600 disabled:opacity-100 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
/**
 * Solid red. The shared "destructive" button variant is a soft tint (10–20%
 * red), which is not what an irreversible action should look like here.
 */
export const API_KEY_REVOKE_CLASS =
  "border border-red-600 bg-red-600 text-white shadow-sm hover:border-red-700 hover:bg-red-700 hover:text-white disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-700"
