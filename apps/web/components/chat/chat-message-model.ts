import type { ChatMessageFeedbackRating } from "@/lib/api/chat"

// ── Types ──────────────────────────────────────────────────────────────────────

export type TokenUsage = { inputTokens: number; outputTokens: number; totalTokens: number }

export type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  thinking?: string
  /** Live status while tools run before answer tokens arrive. */
  streamStatus?: string
  pending?: boolean
  usage?: TokenUsage
  /** Persisted row id (same as id when loaded from history). */
  dbId?: string
  feedback?: ChatMessageFeedbackRating | null
  /**
   * Vision attachments for this user turn (base64, no data: prefix).
   * Shown as thumbnails on the bubble so you can see which image was discussed.
   * Not reloaded from history after refresh (session UI only).
   */
  images?: string[]
  /**
   * Library files (PDFs/docs) attached to this user turn — shown as chips on the bubble.
   * Session UI only (not reloaded from history).
   */
  fileAttachments?: Array<{
    assetId: string
    filename: string
    mediaType: string
    updatedAt: string
  }>
  /**
   * Canvas essay draft produced for this assistant turn.
   * Body is also stored in localStorage for history reload.
   */
  /**
   * Next moves the model proposed for its own draft. Empty when it offered
   * none, in which case the bubble falls back to the derived set.
   */
  followUps?: string[]
  canvasDraft?: {
    id: string
    title: string
    content: string
  }
}

// ── Reasoning / streaming parsing ──────────────────────────────────────────────

/** Opening/closing tags for inline reasoning — may appear mid-stream, not only at offset 0. */
const REASONING_OPEN_TAG =
  /<(?:think(?:ing)?|redacted_reasoning|redacted_think)>\s*/i
const REASONING_CLOSE_TAG =
  /<\/(?:think(?:ing)?|redacted_reasoning|redacted_think)>/i

function parseThinking(raw: string): { thinking: string; response: string; inThink: boolean } {
  const openMatch = raw.match(REASONING_OPEN_TAG)
  if (!openMatch || openMatch.index === undefined) {
    return { thinking: "", response: raw, inThink: false }
  }
  const afterOpen = raw.slice(openMatch.index + openMatch[0].length)
  const closeMatch = afterOpen.match(REASONING_CLOSE_TAG)
  if (!closeMatch || closeMatch.index === undefined) {
    return {
      thinking: afterOpen,
      response: raw.slice(0, openMatch.index),
      inThink: true,
    }
  }
  const thinking = afterOpen.slice(0, closeMatch.index).trim()
  const afterClose = afterOpen.slice(closeMatch.index + closeMatch[0].length)
  const response = (raw.slice(0, openMatch.index) + afterClose).trim()
  return { thinking, response, inThink: false }
}

/**
 * Qwen / Ollama TTY style: model streams plain text starting with `Thinking...` then `...done thinking.`
 * before the user-visible answer. Split so the Thinking panel updates on every chunk.
 */
function splitPlainTextReasoningBlock(accumulated: string): { thinking: string; answer: string; matched: boolean } {
  const lead = accumulated.replace(/^\uFEFF/, "")
  const firstLine = (lead.split(/\r?\n/, 1)[0] ?? "").trimEnd()
  const startsReasoning =
    /^Thinking\b/i.test(firstLine) ||
    /^Thinking\s+process\s*:/im.test(lead.trimStart())
  if (!startsReasoning) {
    return { thinking: "", answer: accumulated, matched: false }
  }

  const endPatterns: RegExp[] = [
    /\n\s*\.{3}\s*done\s+thinking\.?\s*(?:\r?\n)+/i,
    /\n\s*\.{2}\s*done\s+thinking\.?\s*(?:\r?\n)+/i,
    /\n\s*done\s+thinking\.?\s*(?:\r?\n)+/i,
  ]
  for (const re of endPatterns) {
    const m = re.exec(lead)
    if (m?.index !== undefined) {
      return {
        thinking: lead.slice(0, m.index + m[0].length).trimEnd(),
        answer: lead.slice(m.index + m[0].length).trimStart(),
        matched: true,
      }
    }
  }
  return { thinking: lead, answer: "", matched: true }
}

export function deriveStreamingThinkingAndAnswer(
  accumulated: string,
  dedicatedThinking: string,
  showReasoningPanel: boolean,
): { thinking: string; answer: string; inReasoningBlock: boolean } {
  if (dedicatedThinking) {
    return {
      thinking: showReasoningPanel ? dedicatedThinking : "",
      answer: accumulated,
      inReasoningBlock: false,
    }
  }
  const plain = splitPlainTextReasoningBlock(accumulated)
  if (plain.matched) {
    if (showReasoningPanel) {
      return {
        thinking: plain.thinking,
        answer: plain.answer,
        inReasoningBlock: !plain.answer.trim(),
      }
    }
    return {
      thinking: "",
      answer: plain.answer,
      inReasoningBlock: false,
    }
  }
  const tagged = parseThinking(accumulated)
  if (tagged.thinking || tagged.inThink) {
    if (showReasoningPanel) {
      return {
        thinking: tagged.thinking,
        answer: tagged.response,
        inReasoningBlock: tagged.inThink,
      }
    }
    return {
      thinking: "",
      answer: tagged.response,
      inReasoningBlock: false,
    }
  }
  return { thinking: "", answer: accumulated, inReasoningBlock: false }
}

/** Keep the reasoning panel mounted while Show thinking is on and the reply is still streaming. */
export function displayThinkingDuringStream(
  reasoningUiEnabled: boolean,
  derived: { thinking: string; inReasoningBlock: boolean },
): string | undefined {
  if (!reasoningUiEnabled) return undefined
  if (derived.thinking.length > 0 || derived.inReasoningBlock) return derived.thinking
  return ""
}

/**
 * When Ollama streams reasoning in `thinking` but leaves `content` empty, promote thinking
 * into the visible answer so the main bubble is not permanently hidden.
 */
export function resolveFinalAssistantMessage(
  accumulated: string,
  thinkingAccum: string,
  showReasoningPanel: boolean,
  reasoningUiEnabled: boolean,
): { content: string; thinking: string | undefined } {
  const derived = deriveStreamingThinkingAndAnswer(accumulated, thinkingAccum, showReasoningPanel)
  let content = derived.answer.trim()
  let thinking =
    reasoningUiEnabled && (derived.thinking.length > 0 || derived.inReasoningBlock)
      ? derived.thinking
      : undefined

  if (!content && thinking?.trim()) {
    content = thinking.trim()
    thinking = undefined
  } else if (!content) {
    content = accumulated.trim()
  }

  if (content && thinking && content.trim() === thinking.trim()) {
    thinking = undefined
  }

  return { content, thinking }
}

// ── Message list helpers ───────────────────────────────────────────────────────

export function applyAbortedAssistantMessage(prev: Message[], pendingMsgId: string): Message[] {
  const pending = prev.find((m) => m.id === pendingMsgId)
  if (!pending) return prev
  const hasPartial =
    hasVisibleAssistantAnswer(pending.content ?? "") ||
    Boolean((pending.thinking ?? "").trim())
  if (!hasPartial) return prev.filter((m) => m.id !== pendingMsgId)
  return prev.map((m) =>
    m.id === pendingMsgId ? { ...m, pending: false } : m,
  )
}

/** Intentional library UI markers — must always render (covers / filename lists). */
const LIBRARY_UI_TAG_RE =
  /\[\[ASSETS:(?:images|videos|music|documents|all|ids)(?::[^\]]+)?\]\]|\[\[ASSET_LIST:(?:images|videos|music|documents|all|code|python|py)\]\]/i

/**
 * Content that must not appear as the main answer while streaming
 * (tool-call dumps, "let me read the PDF…") — NOT real library tags.
 */
export function isAssistantPlaceholderContent(content: string): boolean {
  const t = content.trim()
  if (!t) return true

  // Cover cards / filename lists are real answers — never treat as junk.
  if (LIBRARY_UI_TAG_RE.test(t)) return false

  // Only leftover tool markup residue (no intentional library tags)
  const withoutTags = t
    .replace(/\[\[ASSETS:[^\]]+\]\]/gi, "")
    .replace(/\[\[ASSET_LIST:[^\]]+\]\]/gi, "")
    .replace(/<\/?tool_call\b[^>]*>/gi, "")
    .replace(/\{[^{}]*"asset_id"[^{}]*\}/gi, "")
    .replace(/\[Attempting to read[^\]]*\]/gi, "")
    .replace(/\[Reading (?:PDF|file)[^\]]*\]/gi, "")
    .trim()
  if (!withoutTags) return true
  // Friendly status strings we put in the bubble ourselves
  if (
    /^(?:working on it|writing in canvas|generating|thinking|reading(?:\s+pdf)?|loading|searching)[….!\s]*$/i.test(
      withoutTags,
    )
  ) {
    return true
  }
  // Model process talk / tool narration (before real answer)
  if (
    /\b(i need to read|let me (?:read|open|fetch|check)|i(?:'ll| will) (?:read|open|fetch)|attempting to read|calling tool|read_pdf_asset|read_text_asset|i already (?:have|attached)|opening the (?:pdf|book|document))\b/i.test(
      withoutTags,
    ) &&
    withoutTags.length < 500
  ) {
    return true
  }
  // Bracketed tool status lines the model sometimes prints
  if (/^\[(?:Attempting to read|Reading)[^\]]*\]/i.test(t) && t.length < 300) {
    return true
  }
  return false
}

/**
 * True when the assistant bubble should show prose and/or asset cards / lists.
 */
export function hasVisibleAssistantAnswer(
  content: string,
  opts?: { streaming?: boolean },
): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  // Library tags always count as a real answer (covers / filenames).
  if (LIBRARY_UI_TAG_RE.test(trimmed)) return true

  if (isAssistantPlaceholderContent(trimmed)) return false

  const proseOnly = trimmed
    .replace(/\[\[ASSETS:[^\]]+\]\]/gi, "")
    .replace(/\[\[ASSET_LIST:[^\]]+\]\]/gi, "")
    .trim()
  if (proseOnly.length > 0) return true

  // Streaming without real prose yet (and no library tags above)
  if (opts?.streaming) return false
  return /\[\[ASSETS:/i.test(trimmed) || /\[\[ASSET_LIST:/i.test(trimmed)
}

/**
 * What to put in the assistant bubble while tokens stream.
 * Never surface process talk under the reasoning panel — but always keep library tags.
 */
export function resolveStreamingBubbleContent(opts: {
  displayContent: string
  streamStatus: string
  forceCanvas?: boolean
}): { content: string; streamStatus?: string } {
  if (opts.forceCanvas) {
    return {
      content: opts.streamStatus || "Writing in Canvas…",
      streamStatus: opts.streamStatus || "Writing in Canvas…",
    }
  }
  const cleaned = opts.displayContent.trim()
  // Keep cover/list tags as soon as they appear so cards render while the rest streams.
  if (LIBRARY_UI_TAG_RE.test(cleaned)) {
    return { content: cleaned, streamStatus: undefined }
  }
  if (!cleaned || isAssistantPlaceholderContent(cleaned)) {
    const status = opts.streamStatus || "Working on it…"
    return { content: "", streamStatus: status }
  }
  return { content: cleaned, streamStatus: undefined }
}

/** Database-backed message id (after save or when loaded from history). */
export function messagePersistId(msg: Message): string | null {
  if (msg.dbId) return msg.dbId
  if (msg.role === "assistant" && /^c[a-z0-9]{20,}$/i.test(msg.id)) return msg.id
  return null
}

export function formatChatSendError(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === "Failed to fetch" || /fetch failed/i.test(err.message)) {
      return "Could not reach the Arciin API. Check that the API is running (pnpm dev or pm2) and reachable from this device."
    }
    return err.message
  }
  return "Something went wrong."
}
