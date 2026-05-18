import { getBrowserApiUrl } from "@/lib/api/browser-api-origin"
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
      try {
        const payload = JSON.parse(request.responseText) as {
          data?: UploadSessionSummary
          error?: { message: string }
        }

        if (request.status >= 200 && request.status < 300 && payload.data) {
          options?.onProgress?.(100)
          resolve(payload.data)
          return
        }

        reject(new Error(payload.error?.message || "Upload failed."))
      } catch {
        reject(new Error("Upload failed."))
      }
    }

    request.onerror = () => reject(new Error("Upload failed."))
    request.send(formData)
  })
}
