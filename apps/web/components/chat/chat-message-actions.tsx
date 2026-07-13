"use client"

import { Loader2, Copy, RotateCcw, Volume2, Square } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { plainTextFromMessage } from "@/lib/chat/plain-text-from-message"
import { useChatTextToSpeech } from "@/hooks/use-chat-text-to-speech"
import { copyTextWithFallback } from "@/lib/utils/clipboard"
import { cn } from "@/lib/utils"

type ChatMessageActionsProps = {
  content: string
  canRegenerate?: boolean
  onRegenerate?: () => void
  profileId?: string | null
  /** Light panel (Ask AI preview); default matches main /chat. */
  variant?: "default" | "light"
}

export function ChatMessageActions({
  content,
  canRegenerate = false,
  onRegenerate,
  profileId,
  variant = "default",
}: ChatMessageActionsProps) {
  const { speaking, loading: ttsLoading, speak, stop: stopSpeech } = useChatTextToSpeech(profileId)
  const plain = plainTextFromMessage(content)

  const actionBtn =
    variant === "light"
      ? "flex size-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
      : "flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/80 hover:text-foreground"

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
    <div className="mt-1.5 flex items-center gap-0.5 px-0.5">
      {canRegenerate && onRegenerate ? (
        <button
          type="button"
          className={actionBtn}
          title="Regenerate"
          aria-label="Regenerate response"
          onClick={onRegenerate}
        >
          <RotateCcw className="size-3.5" />
        </button>
      ) : null}
      <button
        type="button"
        className={actionBtn}
        title="Copy"
        aria-label="Copy response"
        onClick={() => void handleCopy()}
      >
        <Copy className="size-3.5" />
      </button>
      <button
        type="button"
        className={cn(
          actionBtn,
          (speaking || ttsLoading) &&
            (variant === "light" ? "text-[#ff4f12]" : "text-primary"),
        )}
        title={speaking ? "Stop" : "Listen"}
        aria-label={speaking ? "Stop read aloud" : "Listen to response"}
        onClick={() => void handleListen()}
        disabled={!plain || ttsLoading}
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
  )
}
