import { ARCIIN_CLIENT_CHANNEL_HEADER } from "@arciin/config/client"
import { getBrowserApiUrl } from "@/lib/api/browser-api-origin"
import { ApiError } from "@/lib/api/errors"
import { fetchApi } from "@/lib/api/client"
import { sleep } from "@/lib/uploads/sleep"
import type { UploadSessionSummary } from "@/lib/types/models"

export function getUploads(signal?: AbortSignal) {
  return fetchApi<UploadSessionSummary[]>("/uploads", {
    method: "GET",
    signal,
  })
}

export function getUpload(uploadId: string, signal?: AbortSignal) {
  return fetchApi<UploadSessionSummary>(`/uploads/${uploadId}`, {
    method: "GET",
    signal,
  })
}

export function cancelUpload(uploadId: string) {
  return fetchApi<{ success: true }>(`/uploads/${uploadId}/cancel`, {
    method: "POST",
  })
}

type UploadFileOptions = {
  onProgress?: (progress: number) => void
  targetLibraryId?: string
  targetFolderId?: string
}

function retryDelayMs(error: ApiError, attempt: number): number {
  if (error.status === 429) {
    const details = error.details as { retryAfterSeconds?: number } | undefined
    const sec = details?.retryAfterSeconds
    if (typeof sec === "number" && sec > 0) return sec * 1000
    return 15_000
  }
  return Math.min(30_000, 1_500 * 2 ** attempt)
}

function isRetryableUploadError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  if (error.code === "UPLOAD_ABORTED") return false
  if (error.status === 429) return true
  if (error.code === "NETWORK_ERROR") return true
  if (error.status === 502 || error.status === 503 || error.status === 504) return true
  return false
}

function uploadFileOnce(file: File, options?: UploadFileOptions) {
  const params = new URLSearchParams()
  if (options?.targetLibraryId) params.set("targetLibraryId", options.targetLibraryId)
  if (options?.targetFolderId) params.set("targetFolderId", options.targetFolderId)
  const url = getBrowserApiUrl("uploads") + (params.size ? `?${params.toString()}` : "")

  return new Promise<UploadSessionSummary>((resolve, reject) => {
    const formData = new FormData()
    formData.append("file", file)

    const request = new XMLHttpRequest()
    request.open("POST", url)
    request.withCredentials = true
    request.timeout = 0
    request.setRequestHeader(ARCIIN_CLIENT_CHANNEL_HEADER, "web")

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        options?.onProgress?.(Math.round((event.loaded / event.total) * 100))
      }
    })

    request.onload = () => {
      const status = request.status
      const raw = request.responseText?.trim() ?? ""

      if (status >= 200 && status < 300) {
        try {
          const payload = JSON.parse(raw) as {
            data?: UploadSessionSummary
            error?: { message: string; code?: string; details?: unknown }
          }
          if (payload.data) {
            options?.onProgress?.(100)
            resolve(payload.data)
            return
          }
        } catch {
          reject(
            new ApiError("Upload succeeded but the server response was invalid.", {
              status,
              code: "INVALID_RESPONSE",
            }),
          )
          return
        }
      }

      let message = `Upload failed (HTTP ${status}).`
      let code = "UPLOAD_FAILED"
      let details: unknown

      if (raw) {
        try {
          const payload = JSON.parse(raw) as {
            error?: {
              message: string
              code?: string
              details?: unknown
              retryAfterSeconds?: number
            }
          }
          if (payload.error?.message) message = payload.error.message
          if (payload.error?.code) code = payload.error.code
          details =
            payload.error?.details ??
            (payload.error?.retryAfterSeconds != null
              ? { retryAfterSeconds: payload.error.retryAfterSeconds }
              : undefined)
        } catch {
          if (raw.length < 200) message = raw
        }
      } else if (status === 0) {
        message = "Upload failed — no response from the server (network or CORS)."
      }

      reject(new ApiError(message, { status, code, details }))
    }

    request.onerror = () =>
      reject(
        new ApiError("Upload failed — could not reach the server.", {
          status: 0,
          code: "NETWORK_ERROR",
        }),
      )
    request.ontimeout = () =>
      reject(
        new ApiError("Upload timed out — try again or upload fewer files at once.", {
          status: 0,
          code: "NETWORK_ERROR",
        }),
      )
    request.onabort = () =>
      reject(
        new ApiError("Upload cancelled.", {
          status: 0,
          code: "UPLOAD_ABORTED",
        }),
      )
    request.send(formData)
  })
}

export async function uploadFile(file: File, options?: UploadFileOptions) {
  const maxAttempts = 5
  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await uploadFileOnce(file, options)
    } catch (error) {
      lastError = error
      if (!isRetryableUploadError(error) || attempt === maxAttempts - 1) {
        throw error
      }
      await sleep(retryDelayMs(error as ApiError, attempt))
    }
  }

  throw lastError
}
