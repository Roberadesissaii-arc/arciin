import { fetchApi } from "@/lib/api/client"
import type {
  CreateShareInput,
  CreateShareResult,
  PublicShareView,
  ShareLinkSummary,
} from "@/lib/types/models"

export function listShareLinks(signal?: AbortSignal) {
  return fetchApi<ShareLinkSummary[]>("/shares", { signal })
}

export function createShareLink(input: CreateShareInput) {
  return fetchApi<CreateShareResult>("/shares", {
    method: "POST",
    body: input,
  })
}

export function revokeShareLink(shareId: string) {
  return fetchApi<{ success: boolean }>(`/shares/${shareId}`, {
    method: "DELETE",
  })
}

export function getPublicShareView(token: string, folderId?: string, signal?: AbortSignal) {
  const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""
  return fetchApi<PublicShareView>(`/shares/access/${encodeURIComponent(token)}${query}`, {
    signal,
    credentials: "omit",
  })
}

export function publicShareDownloadUrl(token: string, assetId: string, inline = false) {
  const base = `/api/shares/access/${encodeURIComponent(token)}/download/${encodeURIComponent(assetId)}`
  return inline ? `${base}?inline=1` : base
}

export function publicSharePreviewUrl(token: string, assetId: string) {
  return publicShareDownloadUrl(token, assetId, true)
}

export function publicShareThumbnailUrl(token: string, assetId: string) {
  return `/api/shares/access/${encodeURIComponent(token)}/thumbnail/${encodeURIComponent(assetId)}`
}

export type ShareFeedbackSentiment = "LIKE" | "DISLIKE"

export function submitPublicShareFeedback(
  token: string,
  input: { sentiment: ShareFeedbackSentiment; assetId?: string },
) {
  return fetchApi<{ success: boolean }>(`/shares/access/${encodeURIComponent(token)}/feedback`, {
    method: "POST",
    body: input,
    credentials: "omit",
  })
}
