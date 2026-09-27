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
  /** Upload terms from the server: chunked, resumable, and the effective per-file limit. */
  upload?: {
    resumable: boolean
    chunkSize: number
    maximumUploadBytes: number
  }
}

export function getPublicFileRequest(token: string, signal?: AbortSignal) {
  return fetchApi<PublicFileRequestView>(
    `/public/file-requests/${encodeURIComponent(token)}`,
    // `credentials: "omit"` matters: a recipient who happens to be signed in to
    // this Arciin must be treated exactly like a stranger on this page.
    { signal, credentials: "omit" },
  )
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
