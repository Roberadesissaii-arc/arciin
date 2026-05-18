import { getBrowserApiUrl } from "@/lib/api/browser-api-origin"
import { ApiError } from "@/lib/api/errors"
import { fetchApi } from "@/lib/api/client"
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

export function uploadFile(
  file: File,
  options?: {
    onProgress?: (progress: number) => void
    targetLibraryId?: string
    targetFolderId?: string
  }
) {
  const params = new URLSearchParams()
  if (options?.targetLibraryId) params.set("targetLibraryId", options.targetLibraryId)
  if (options?.targetFolderId)  params.set("targetFolderId",  options.targetFolderId)
  const url = getBrowserApiUrl("uploads") + (params.size ? `?${params.toString()}` : "")

  return new Promise<UploadSessionSummary>((resolve, reject) => {
    const formData = new FormData()
    formData.append("file", file)

    const request = new XMLHttpRequest()
    request.open("POST", url)
    request.withCredentials = true

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
            error?: { message: string; code?: string; details?: unknown }
          }
          if (payload.error?.message) message = payload.error.message
          if (payload.error?.code) code = payload.error.code
          details = payload.error?.details
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
