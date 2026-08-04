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

/** True when the assistant bubble should show prose and/or asset cards. */
export function hasVisibleAssistantAnswer(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false
  const proseOnly = trimmed.replace(/\[\[ASSETS:[^\]]+\]\]/gi, "").trim()
  if (proseOnly.length > 0) return true
  return /\[\[ASSETS:/i.test(trimmed)
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
