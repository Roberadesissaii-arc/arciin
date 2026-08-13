/**
 * Compact relative time for library media cards.
 * en-GB day+month when older than a week (e.g. "12 Aug").
 */
export function formatCardRelativeTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "—"

  const diffMs = Date.now() - date.getTime()
  const sec = Math.max(0, Math.floor(diffMs / 1000))

  if (sec < 60) return "Just now"

  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`

  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  if (hr < 48) return "Yesterday"

  const days = Math.floor(hr / 24)
  if (days < 7) return `${days} days ago`

  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}
