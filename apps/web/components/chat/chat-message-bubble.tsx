"use client"

import {
  Copy, Loader2, RotateCcw, Sparkles, Square, ThumbsDown, ThumbsUp, User, Volume2,
} from "lucide-react"

import { useChatTextToSpeech } from "@/hooks/use-chat-text-to-speech"
import { plainTextFromMessage } from "@/lib/chat/plain-text-from-message"
import { toast } from "@/lib/notifications/arciin-toast"
import { copyTextWithFallback } from "@/lib/utils/clipboard"
import { cn } from "@/lib/utils"
import type { ChatMessageFeedbackRating } from "@/lib/api/chat"

import { MarkdownContent } from "@/components/chat/chat-markdown"
import { ThinkingBlock } from "@/components/chat/thinking-block"
import {
  hasVisibleAssistantAnswer,
  type Message,
  type TokenUsage,
} from "@/components/chat/chat-message-model"

// ── Message actions ────────────────────────────────────────────────────────────

function MessageActions({
  content,
  usage,
  feedback,
  canRegenerate,
  onRegenerate,
  onFeedback,
  profileId,
}: {
  content: string
  usage?: TokenUsage
  feedback?: ChatMessageFeedbackRating | null
  canRegenerate: boolean
  onRegenerate?: () => void
  onFeedback: (rating: ChatMessageFeedbackRating | null) => void
  profileId?: string | null
}) {
  const { speaking, loading: ttsLoading, speak, stop: stopSpeech } = useChatTextToSpeech(profileId)
  const plain = plainTextFromMessage(content)
  const actionBtn =
    "flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/80 hover:text-foreground"

  async function handleCopy() {
    const ok = await copyTextWithFallback(plain || content)
    if (ok) {
      toast.success("Copied to clipboard", { description: "The message text is ready to paste." })
    } else {
      toast.error("Could not copy", { description: "Select and copy the text manually." })
    }
  }

  async function handleListen() {
    if (!plain) {
      toast.error("Nothing to read aloud", { description: "This message has no readable text." })
      return
    }
    if (speaking) {
      stopSpeech()
      return
    }
    const started = await speak(plain)
    if (!started) {
      toast.error("Could not start read aloud", {
        description: "Check your text-to-speech settings and try again.",
      })
    }
  }

  return (
    <div className="mt-1.5 flex items-center justify-between gap-3 px-0.5">
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          className={cn(actionBtn, feedback === "LIKE" && "text-primary")}
          title="Good response"
          onClick={() => onFeedback(feedback === "LIKE" ? null : "LIKE")}
        >
          <ThumbsUp className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(actionBtn, feedback === "DISLIKE" && "text-red-500")}
          title="Poor response"
          onClick={() => onFeedback(feedback === "DISLIKE" ? null : "DISLIKE")}
        >
          <ThumbsDown className="size-3.5" />
        </button>
        {canRegenerate && onRegenerate ? (
          <button type="button" className={actionBtn} title="Regenerate" onClick={onRegenerate}>
            <RotateCcw className="size-3.5" />
          </button>
        ) : null}
        <button type="button" className={actionBtn} title="Copy" onClick={() => void handleCopy()}>
          <Copy className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(actionBtn, (speaking || ttsLoading) && "text-primary")}
          title={speaking ? "Stop" : "Listen"}
          aria-label={speaking ? "Stop read aloud" : "Listen to response"}
          disabled={!plain || ttsLoading}
          onClick={() => void handleListen()}
        >
          {ttsLoading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : speaking ? (
            <Square className="size-3.5 fill-current" />
          ) : (
            <Volume2 className="size-3.5" />
          )}
        </button>
      </div>
      {usage ? (
        <div className="flex min-w-0 items-center justify-end gap-1.5 font-mono text-[10px] text-zinc-400">
          <span title="Input tokens">{usage.inputTokens.toLocaleString()} in</span>
          <span className="text-zinc-600">·</span>
          <span title="Output tokens">{usage.outputTokens.toLocaleString()} out</span>
          <span className="text-zinc-600">·</span>
          <span title="Total tokens" className="text-zinc-500">
            {usage.totalTokens.toLocaleString()} total
          </span>
        </div>
      ) : null}
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────

export function MessageBubble({
  msg,
  isLive = false,
  reasoningUiEnabled = false,
  isStreaming = false,
  canRegenerate = false,
  onRegenerate,
  onFeedback,
  profileId,
}: {
  msg: Message
  isLive?: boolean
  reasoningUiEnabled?: boolean
  isStreaming?: boolean
  canRegenerate?: boolean
  onRegenerate?: () => void
  onFeedback?: (rating: ChatMessageFeedbackRating | null) => void
  profileId?: string | null
}) {
  const isUser = msg.role === "user"
  const hasThinkingText = Boolean((msg.thinking ?? "").length > 0)
  /**
   * Reasoning panel only when this message has a thinking field
   * (Think chip on for that turn, or stored reasoning from history).
   * Settings alone no longer force an empty “thinking” shell on every reply.
   */
  const reasoningActive =
    !isUser && (hasThinkingText || msg.thinking !== undefined)
  const showThinkingRow =
    reasoningActive && (hasThinkingText || isStreaming || msg.thinking !== undefined)
  const liveThinking = Boolean(reasoningActive && isStreaming)

  const hasVisibleAnswer = hasVisibleAssistantAnswer(msg.content ?? "")

  /**
   * With reasoning enabled: hide the answer card until reply text (or asset tags) appears,
   * so reasoning streams first; answer then streams in its own bubble below.
   */
  const hideMainAnswerBubble =
    !isUser &&
    !hasVisibleAnswer &&
    reasoningActive &&
    (hasThinkingText || isStreaming || Boolean(msg.pending))

  const showNeutralGenerating =
    !isUser &&
    !reasoningActive &&
    isStreaming &&
    !hasVisibleAnswer

  const showComposingInBubble =
    !hideMainAnswerBubble &&
    !showNeutralGenerating &&
    ((msg.pending && !hasVisibleAnswer && !hasThinkingText && !isStreaming) ||
      (isStreaming && !hasVisibleAnswer && !hasThinkingText && !showThinkingRow) ||
      (isStreaming && Boolean(msg.streamStatus) && !hasVisibleAnswer))

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
          isUser ? "bg-primary text-white" : "border border-border bg-muted text-primary"
        }`}
      >
        {isUser ? <User className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </div>

      <div className={isUser ? "max-w-[78%]" : "max-w-[88%]"}>
        {showThinkingRow && (
          <ThinkingBlock content={msg.thinking ?? ""} live={liveThinking} />
        )}

        {!hideMainAnswerBubble && (
        <div
          className={`rounded-2xl px-4 py-2.5 text-[13px] leading-relaxed ${
            isUser
              ? "rounded-tr-sm bg-primary text-white"
              : "rounded-tl-sm border border-border bg-card text-foreground"
          }`}
        >
          {showNeutralGenerating ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Generating…
            </span>
          ) : showComposingInBubble ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {msg.streamStatus ?? "Working on it…"}
            </span>
          ) : isUser ? (
            <div className="space-y-2">
              {msg.images && msg.images.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {msg.images.map((b64, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={`data:image/jpeg;base64,${b64}`}
                      alt={`Attached image ${i + 1}`}
                      className="max-h-36 max-w-[min(100%,12rem)] rounded-lg border border-white/25 object-cover shadow-sm"
                    />
                  ))}
                </div>
              ) : null}
              {msg.content.trim() ? (
                <span className="whitespace-pre-wrap">{msg.content}</span>
              ) : null}
            </div>
          ) : isLive ? (
            <span className="whitespace-pre-wrap">
              {msg.content}
              {isStreaming ? (
                <span
                  className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-px animate-pulse bg-primary/80 align-middle"
                  aria-hidden
                />
              ) : null}
            </span>
          ) : (
            <MarkdownContent content={msg.content} />
          )}
        </div>
        )}

        {!isUser && !msg.pending && !isStreaming && hasVisibleAnswer && onFeedback && (
          <MessageActions
            content={msg.content}
            usage={msg.usage}
            feedback={msg.feedback}
            canRegenerate={canRegenerate}
            onRegenerate={onRegenerate}
            onFeedback={onFeedback}
            profileId={profileId}
          />
        )}
      </div>
    </div>
  )
}
