import { getBrowserApiUrl } from "@/lib/api/browser-api-origin"
import { fetchApi } from "@/lib/api/client"

/** POST URL for SSE chat — uses the page origin in the browser so session cookies apply on LAN IPs. */
export function getChatStreamPostUrl(): string {
  return getBrowserApiUrl("chat")
}

/** Parse Fastify error JSON from a failed chat POST (before SSE starts). */
export async function parseChatHttpError(res: Response): Promise<string> {
  const prefix = `Chat failed (${res.status})`
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    const detail = body?.error?.message?.trim()
    return detail ? `${prefix}: ${detail}` : prefix
  } catch {
    return res.status === 500 ? `${prefix}. Check that the API is running.` : prefix
  }
}

/** Open-file context for inline library preview chat. */
export type ChatFocusAsset = {
  assetId: string
  currentPage?: number
}

export interface ChatInstanceContext {
  libraries: { id: string; slug: string; name: string; kind: string; count: number }[]
  folders: {
    id: string
    libraryId: string
    librarySlug: string
    name: string
    pathCache: string
    assetCount: number
  }[]
  /** Arciin App data databases (logical JSON stores in Postgres — same payload as GET /app-databases metadata). Not library Documents. */
  appDatabases: {
    id: string
    name: string
    slug: string
    description: string | null
    tableCount: number
    createdAt: string
  }[]
  byMediaType: { type: string; count: number }[]
  /** Recent source-code / script files (.py, .js, etc.) — filenames only, not file bodies. */
  codeFiles?: {
    id: string
    filename: string
    mediaType: string
    sizeBytes: number
    librarySlug: string
    libraryName: string
  }[]
  documentFiles?: {
    id: string
    filename: string
    mediaType: string
    sizeBytes: number
    librarySlug: string
    libraryName: string
  }[]
  /** True count of documents when `documentFiles` above is a truncated preview. */
  documentFilesTotal?: number
  storageGb: number
  lastUploadAt: string | null
  /** Count-only vault hint for AI — never contains secrets. */
  passwordVaultLine?: string | null
}

export interface ChatConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  profile: { id: string; displayName: string; provider: string } | null
  messages: { role: string; content: string }[]
}

export type ChatMessageFeedbackRating = "LIKE" | "DISLIKE"

export interface ChatMessageRecord {
  id: string
  conversationId: string
  role: string
  content: string
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  feedbackRating: ChatMessageFeedbackRating | null
  feedbackAt: string | null
  createdAt: string
}

export interface ChatConversationDetail extends Omit<ChatConversationSummary, "messages"> {
  messages: ChatMessageRecord[]
}

export function getChatConversations(signal?: AbortSignal) {
  return fetchApi<ChatConversationSummary[]>("/chat/conversations", { method: "GET", signal })
}

export function getChatConversation(id: string, signal?: AbortSignal) {
  return fetchApi<ChatConversationDetail>(`/chat/conversations/${id}`, { method: "GET", signal })
}

export function createChatConversation(input: { title: string; profileId?: string }) {
  return fetchApi<{ id: string; title: string; createdAt: string; updatedAt: string }>(
    "/chat/conversations",
    { method: "POST", body: input },
  )
}

export function saveChatMessages(input: {
  conversationId: string
  messages: {
    role: string
    content: string
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }[]
}) {
  return fetchApi<{
    messages: {
      id: string
      role: string
      feedbackRating: ChatMessageFeedbackRating | null
      createdAt: string
    }[]
  }>("/chat/conversations/messages", { method: "POST", body: input })
}

export function setChatMessageFeedback(
  messageId: string,
  rating: ChatMessageFeedbackRating | null,
) {
  return fetchApi<{
    id: string
    feedbackRating: ChatMessageFeedbackRating | null
    feedbackAt: string | null
  }>(`/chat/messages/${messageId}/feedback`, { method: "PATCH", body: { rating } })
}

export function updateChatMessage(
  messageId: string,
  body: {
    content: string
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  },
) {
  return fetchApi<ChatMessageRecord>(`/chat/messages/${messageId}`, { method: "PATCH", body })
}

export function deleteChatConversation(id: string) {
  return fetchApi<{ success: true }>(`/chat/conversations/${id}`, { method: "DELETE" })
}

export function getChatInstanceContext(signal?: AbortSignal) {
  return fetchApi<ChatInstanceContext>("/chat/context", { method: "GET", signal })
}

/** Base64 image blobs for the latest user message (Ollama vision). */
export function getChatVisionRecent(limit: 1 | 2 | 3 = 1, signal?: AbortSignal) {
  const n = Math.min(3, Math.max(1, limit))
  return fetchApi<{ images: string[] }>(`/chat/vision-recent?limit=${n}`, { method: "GET", signal })
}

export type VisionSearchMatch = {
  assetId: string
  originalFilename: string
  confidence: number
  summary: string
}

export function postChatVisionSearch(body: {
  query: string
  profileId: string
  model?: string
  maxResults?: number
}) {
  return fetchApi<{ query: string; scanned: number; matches: VisionSearchMatch[] }>(
    "/chat/vision-search",
    { method: "POST", body },
  )
}

export function postChatVisionSuggestRename(body: {
  profileId: string
  model?: string
  assetId?: string
}) {
  return fetchApi<{
    assetId: string
    suggestedTitle: string
    suggestedFilename: string
    description: string
  }>("/chat/vision-suggest-rename", { method: "POST", body })
}

export type OrganizeImageResult = {
  assetId: string
  originalFilename: string
  status: "moved" | "skipped" | "failed"
  folderName?: string
  folderId?: string
  createdFolder?: boolean
  summary?: string
  error?: string
}

export function postChatOrganizeImages(body: {
  profileId: string
  model?: string
  maxAssets?: number
}) {
  return fetchApi<{
    libraryId: string
    libraryName: string
    processed: number
    results: OrganizeImageResult[]
  }>("/chat/organize-images", { method: "POST", body })
}

/**
 * Ask the server to name a conversation from its opening exchange.
 *
 * Fire-and-forget from the caller's point of view: the title is cosmetic, so a
 * failure leaves the placeholder in place rather than interrupting the chat.
 */
export function autoTitleChatConversation(id: string) {
  return fetchApi<{ id: string; title: string }>(`/chat/conversations/${id}/auto-title`, {
    method: "POST",
    body: {},
  })
}

export function renameChatConversation(id: string, title: string) {
  return fetchApi<{ id: string; title: string }>(`/chat/conversations/${id}`, {
    method: "PATCH",
    body: { title },
  })
}

export type ChatSelection = {
  profileId: string
  model: string
}

export function getChatSelection(signal?: AbortSignal) {
  return fetchApi<ChatSelection | null>("/chat/selection", { method: "GET", signal })
}

export function setChatSelection(input: ChatSelection) {
  return fetchApi<ChatSelection>("/chat/selection", { method: "PUT", body: input })
}
