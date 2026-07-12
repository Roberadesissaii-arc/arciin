import type { ActivitySummary } from "@/lib/types/models"

const ENTITY_TYPE_LABELS: Record<string, string> = {
  asset: "Asset",
  folder: "Folder",
  library: "Library",
  upload: "Upload",
  share: "Share",
  webhook: "Webhook",
  "api-key": "API key",
  instance: "Instance",
  remote: "Remote",
  settings: "Settings",
  "app-database": "Database",
  "app-database-folder": "Database",
  security: "Security",
  profile: "Profile",
}

const TYPE_CATEGORY_LABELS: Record<string, string> = {
  upload: "Upload",
  asset: "File",
  folder: "Folder",
  share: "Share",
  webhook: "Webhook",
  "api-key": "API key",
  instance: "Instance",
  remote: "Remote",
  settings: "Settings",
  appdata: "App data",
  profile: "Profile",
  storage: "Storage",
}

function titleCase(value: string) {
  return value
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

/** Short category for the Type column (Upload, File, Folder, …). */
export function activityLogTypeLabel(type: string): string {
  const [entity = ""] = type.split(".")
  return TYPE_CATEGORY_LABELS[entity] ?? titleCase(entity)
}

/** What was affected — library item, folder, webhook, etc. */
export function activityLogSubjectLabel(event: ActivitySummary): string | null {
  if (event.entityType?.trim()) {
    const key = event.entityType.trim()
    return ENTITY_TYPE_LABELS[key] ?? titleCase(key)
  }

  const category = activityLogTypeLabel(event.type)
  return category || null
}

/** Primary action line — title preferred. */
export function activityLogEventLabel(event: ActivitySummary): string {
  return event.title.trim()
}

/** Supporting detail — usually the message body. */
export function activityLogDetails(event: ActivitySummary): string | null {
  const message = event.message?.trim()
  if (message) return message
  return null
}

const DETAILS_PREVIEW_MAX = 52

/** Short preview for the Details column — full text stays in the row title tooltip. */
export function activityLogDetailsPreview(details: string | null): string | null {
  if (!details) return null
  if (details.length <= DETAILS_PREVIEW_MAX) return details
  return `${details.slice(0, DETAILS_PREVIEW_MAX).trimEnd()}…`
}

export const ACTIVITY_LOG_GRID =
  "sm:grid sm:grid-cols-[minmax(4.75rem,1fr)_minmax(5.5rem,0.9fr)_minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(4.5rem,0.75fr)] sm:items-center sm:gap-x-3"
