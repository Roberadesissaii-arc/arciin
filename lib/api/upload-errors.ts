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
    if (error.status === 429 || error.code === "RATE_LIMITED") {
      parts.push("(Server rate limit — Arciin will retry automatically; wait or upload in smaller batches.)")
    }
    if (error.code === "NETWORK_ERROR") {
      parts.push("(Connection dropped — often too many files at once; retrying may help.)")
    }
    if (error.status === 413) {
      parts.push("(File exceeds the server upload size limit.)")
    }
    if (
      error.status === 500 &&
      /internal server error/i.test(error.message) &&
      !parts.some((p) => /size|limit|large/i.test(p))
    ) {
      parts.push(
        "(Large files may exceed the proxy limit — set MAX_UPLOAD_SIZE_MB in .env and restart web + API.)",
      )
    }
    return parts.join(" ")
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return "Upload failed — network or server error."
}
