import { formatDistanceToNowStrict, format } from "date-fns"

export function formatRelativeDate(value: string | Date) {
  return formatDistanceToNowStrict(new Date(value), {
    addSuffix: true,
  })
}

export function formatDateTime(value: string | Date) {
  return format(new Date(value), "MMM d, yyyy 'at' h:mm a")
}
