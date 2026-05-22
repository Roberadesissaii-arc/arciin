"use client"

import { Loader2, Sparkles, User } from "lucide-react"

import { ChatMessageActions } from "@/components/chat/chat-message-actions"
import { ChatMarkdownContent } from "@/components/chat/chat-markdown-content"
import { cn } from "@/lib/utils"

export function PreviewChatMessage({
  role,
  content,
  isStreaming = false,
  canRegenerate = false,
  onRegenerate,
}: {
  role: "user" | "assistant"
  content: string
  isStreaming?: boolean
  canRegenerate?: boolean
  onRegenerate?: () => void
}) {
  const isUser = role === "user"
  const hasContent = content.trim().length > 0

  return (
    <div className={cn("flex gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-[#ff4f12] text-white" : "border border-zinc-200 bg-white text-[#ff4f12]",
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </div>

      <div
        className={cn(
          "min-w-0",
          isUser ? "max-w-[85%]" : "max-w-[calc(100%-2.25rem)] flex-1",
        )}
      >
        <div
          className={cn(
            "min-w-0 rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed",
            isUser
              ? "rounded-tr-sm bg-[#ff4f12] text-white"
              : "rounded-tl-sm border border-zinc-200 bg-zinc-50/90 text-zinc-900",
            !isUser && "overflow-x-visible",
          )}
        >
          {isUser ? (
            <span className="whitespace-pre-wrap break-words">{content}</span>
          ) : !hasContent && isStreaming ? (
            <span className="flex items-center gap-1.5 text-zinc-500">
              <Loader2 className="size-3.5 animate-spin text-[#ff4f12]" />
              Working on it…
            </span>
          ) : (
            <div className="min-w-0">
              <ChatMarkdownContent content={content} />
              {isStreaming ? (
                <span
                  className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-px animate-pulse bg-[#ff4f12]/80 align-middle"
                  aria-hidden
                />
              ) : null}
            </div>
          )}
        </div>
        {!isUser && hasContent && !isStreaming ? (
          <ChatMessageActions
            content={content}
            canRegenerate={canRegenerate}
            onRegenerate={onRegenerate}
            variant="light"
          />
        ) : null}
      </div>
    </div>
  )
}
