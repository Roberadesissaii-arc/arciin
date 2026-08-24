import type { JobSummary } from "@/lib/types/models"

export function formatJobTypeLabel(type: string) {
  return type
    .split(/[._-]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

export function formatJobIdLabel(id: string) {
  return `${id.slice(0, 8)}…`
}

/** Short badge label for the job category column (matches Activity type badges). */
export function jobTypeBadgeLabel(type: string) {
  switch (type) {
    case "import_url":
      return "IMPORT"
    case "generate_thumbnail":
      return "THUMB"
    case "extract_metadata":
      return "META"
    case "analyze_file":
      return "ANALYZE"
    case "sync_connector_mirror":
      return "SYNC"
    case "cleanup_temp_files":
      return "CLEANUP"
    case "calculate_storage_usage":
      return "STORAGE"
    case "migrate_storage":
      return "MIGRATE"
    // Dubbing was removed. Historical rows remain, and the default branch
    // rendered them as "DUB MEDI" — a truncated label for a feature that no
    // longer exists, which reads like something still on offer.
    case "dub_media":
      return "REMOVED"
    case "plex_sync_placeholder":
      return "PLEX"
    default:
      return type.replace(/_/g, " ").slice(0, 8).toUpperCase() || "JOB"
  }
}

export function jobQueueStatus(job: JobSummary): {
  label: string
  tone: "good" | "bad" | "warn" | "muted"
} {
  switch (job.status) {
    case "COMPLETED":
      return { label: "Completed", tone: "good" }
    case "FAILED":
      return { label: "Failed", tone: "bad" }
    case "ACTIVE":
      return { label: "Running", tone: "warn" }
    case "QUEUED":
    default:
      return { label: "Queued", tone: "muted" }
  }
}

function truncateMiddle(value: string, max = 52): string {
  const trimmed = value.trim()
  if (trimmed.length <= max) return trimmed
  return `${trimmed.slice(0, max - 1)}…`
}

/** Human-readable context for the Details column. */
export function jobDetailsPreview(job: JobSummary): string | null {
  if (job.status === "FAILED" && job.error?.trim()) {
    return job.error.trim()
  }

  const payload = job.payload ?? {}

  if (typeof payload.url === "string" && payload.url.trim()) {
    return truncateMiddle(payload.url)
  }

  if (typeof payload.assetId === "string" && payload.assetId.trim()) {
    return `Asset ${formatJobIdLabel(payload.assetId)}`
  }

  if (typeof payload.uploadId === "string" && payload.uploadId.trim()) {
    return `Upload ${formatJobIdLabel(payload.uploadId)}`
  }

  if (job.result && typeof job.result === "object") {
    const result = job.result as Record<string, unknown>
    if (typeof result.message === "string" && result.message.trim()) {
      return result.message.trim()
    }
  }

  return null
}

export function jobSubjectLabel(job: JobSummary): string {
  return formatJobIdLabel(job.id)
}
