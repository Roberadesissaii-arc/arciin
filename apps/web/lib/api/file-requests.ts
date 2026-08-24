import { fetchApi } from "@/lib/api/client"

export type FileRequestDestination = {
  folderName: string
  libraryName: string | null
  librarySlug: string | null
  folderId: string
}

export type FileRequestSummary = {
  id: string
  title: string
  message: string | null
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "LIMIT_REACHED"
  tokenPrefix: string
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  submissionCount: number
  fileCount: number
  totalBytes: number
  maxFileCount: number | null
  maxTotalBytes: number | null
  maxFileSizeBytes: number | null
  allowedExtensions: string[]
  allowedMediaTypes: string[]
  requireName: boolean
  requireEmail: boolean
  allowAnonymous: boolean
  allowSubmitterViewOwn: boolean
  notifyOwner: boolean
  hasAccessCode: boolean
  destination: FileRequestDestination | null
}

/** The raw token is present only on the creation response — it is never stored. */
export type CreatedFileRequest = FileRequestSummary & { token: string }

export type CreateFileRequestInput = {
  title: string
  message?: string
  destinationFolderId: string
  expiresInDays?: number
  maxFileCount?: number | null
  maxTotalBytes?: number | null
  maxFileSizeBytes?: number | null
  allowedExtensions?: string[]
  allowedMediaTypes?: string[]
  requireName?: boolean
  requireEmail?: boolean
  allowAnonymous?: boolean
  allowSubmitterViewOwn?: boolean
  notifyOwner?: boolean
  accessCode?: string
}

export function listFileRequests(signal?: AbortSignal) {
  return fetchApi<FileRequestSummary[]>("/file-requests", { signal })
}

export function createFileRequest(input: CreateFileRequestInput) {
  return fetchApi<CreatedFileRequest>("/file-requests", { method: "POST", body: input })
}

export function revokeFileRequest(id: string) {
  return fetchApi<{ success: boolean }>(`/file-requests/${id}/revoke`, { method: "POST" })
}

export function extendFileRequest(id: string, days: number) {
  return fetchApi<FileRequestSummary>(`/file-requests/${id}/extend`, {
    method: "POST",
    body: { days },
  })
}

// ---------------------------------------------------------------------------
// Public — used by /request/[token], which has no session
// ---------------------------------------------------------------------------

export type PublicFileRequestView = {
  title: string
  message: string | null
  expiresAt: string | null
  requireName: boolean
  requireEmail: boolean
  requiresAccessCode: boolean
  allowedExtensions: string[]
  allowedMediaTypes: string[]
  maxFileSizeBytes: number | null
  remainingFileCount: number | null
  remainingBytes: number | null
  allowSubmitterViewOwn: boolean
}

export function getPublicFileRequest(token: string, signal?: AbortSignal) {
  return fetchApi<PublicFileRequestView>(
    `/public/file-requests/${encodeURIComponent(token)}`,
    // `credentials: "omit"` matters: a recipient who happens to be signed in to
    // this Arciin must be treated exactly like a stranger on this page.
    { signal, credentials: "omit" },
  )
}

export type SubmitFileResult = {
  submissionId: string
  fileName: string
  sizeBytes: number
  status: string
}

export type SubmitFileError = {
  code: string
  message: string
  status: number
}

/**
 * Upload one file. Uses XHR rather than fetch because per-file progress is the
 * whole point of this screen and fetch still cannot report upload progress.
 */
export function submitFileToRequest(
  token: string,
  input: {
    file: File
    submissionId?: string | null
    submitterName?: string | null
    submitterEmail?: string | null
    accessCode?: string | null
    idempotencyKey: string
  },
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<SubmitFileResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    if (input.submissionId) form.append("submissionId", input.submissionId)
    if (input.submitterName) form.append("submitterName", input.submitterName)
    if (input.submitterEmail) form.append("submitterEmail", input.submitterEmail)
    if (input.accessCode) form.append("accessCode", input.accessCode)
    // The file part must come last: the server reads text fields off the same
    // multipart stream, and Fastify surfaces only the fields seen before it.
    form.append("file", input.file, input.file.name)

    const xhr = new XMLHttpRequest()
    xhr.open("POST", `/api/public/file-requests/${encodeURIComponent(token)}/submissions`)
    xhr.setRequestHeader("Idempotency-Key", input.idempotencyKey)
    xhr.withCredentials = false

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total)
    }

    xhr.onload = () => {
      let body: { data?: SubmitFileResult; error?: { code: string; message: string } } = {}
      try {
        body = JSON.parse(xhr.responseText || "{}")
      } catch {
        // fall through to the generic failure below
      }

      if (xhr.status >= 200 && xhr.status < 300 && body.data) {
        resolve(body.data)
        return
      }

      const error: SubmitFileError = {
        code: body.error?.code ?? "UPLOAD_FAILED",
        message: body.error?.message ?? "The upload could not be completed.",
        status: xhr.status,
      }
      reject(error)
    }

    xhr.onerror = () =>
      reject({ code: "NETWORK", message: "The connection was lost.", status: 0 } as SubmitFileError)
    xhr.onabort = () =>
      reject({ code: "ABORTED", message: "Upload cancelled.", status: 0 } as SubmitFileError)

    signal?.addEventListener("abort", () => xhr.abort())
    xhr.send(form)
  })
}

export function completeFileRequestSubmission(token: string, submissionId: string) {
  return fetchApi<{
    submissionId: string
    fileCount: number
    totalBytes: number
    status: string
  }>(
    `/public/file-requests/${encodeURIComponent(token)}/submissions/${encodeURIComponent(
      submissionId,
    )}/complete`,
    { method: "POST", credentials: "omit" },
  )
}
