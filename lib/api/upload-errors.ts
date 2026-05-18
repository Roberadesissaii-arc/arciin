import { ApiError } from "@/lib/api/errors"

export function formatUploadFailure(error: unknown): string {
  if (error instanceof ApiError) {
    const parts = [error.message]
    if (error.code && !error.message.includes(error.code)) {
      parts.push(`[${error.code}]`)
    }
    if (error.status === 403) {
      parts.push("(Your IP may be blocked — check Security.)")
    }
    if (error.status === 429) {
      parts.push("(Rate limit — try fewer files at once.)")
    }
    return parts.join(" ")
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return "Upload failed — network or server error."
}
