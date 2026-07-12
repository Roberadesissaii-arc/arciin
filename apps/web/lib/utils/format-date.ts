import { formatDistanceToNowStrict, format } from "date-fns"

const RELATIVE_UNIT_SHORT: Record<string, string> = {
  second: "s",
  seconds: "s",
  minute: "m",
  minutes: "m",
  hour: "h",
  hours: "h",
  day: "d",
  days: "d",
  week: "w",
  weeks: "w",
  month: "mo",
  months: "mo",
  year: "y",
  years: "y",
}

export function formatRelativeDate(value: string | Date) {
  return formatDistanceToNowStrict(new Date(value), {
    addSuffix: true,
  })
}

/** Compact relative time for tight layouts (e.g. dashboard activity on tablet). */
export function formatRelativeDateShort(value: string | Date) {
  const raw = formatDistanceToNowStrict(new Date(value), { addSuffix: false })
  const match = raw.match(/^(\d+)\s+(\w+)/)
  if (!match) return raw
  const [, amount, unit] = match
  const suffix = RELATIVE_UNIT_SHORT[unit] ?? unit.slice(0, 1)
  return `${amount}${suffix}`
}

export function formatDateTime(value: string | Date) {
  return format(new Date(value), "MMM d, yyyy 'at' h:mm a")
}
