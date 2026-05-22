"use client"

import { useMemo } from "react"
import { Copy, RotateCcw, Volume2, Square } from "lucide-react"
import { toast } from "sonner"

import { plainTextFromMessage } from "@/lib/chat/plain-text-from-message"
import { useTextToSpeech } from "@/hooks/use-text-to-speech"
import { cn } from "@/lib/utils"

type ChatMessageActionsProps = {
  content: string
  canRegenerate?: boolean
  onRegenerate?: () => void
  /** Light panel (Ask AI preview); default matches main /chat. */
  variant?: "default" | "light"
}

export function ChatMessageActions({
  content,
  canRegenerate = false,
  onRegenerate,
  variant = "default",
}: ChatMessageActionsProps) {
  const { supported: ttsSupported, speaking, speak, stop: stopSpeech } = useTextToSpeech()
  const plain = useMemo(() => plainTextFromMessage(content), [content])

  const actionBtn =
    variant === "light"
      ? "flex size-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
      : "flex size-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted/80 hover:text-foreground"

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(plain || content)
      toast.success("Copied to clipboard")
    } catch {
      toast.error("Could not copy")
    }
  }

  async function handleListen() {
    if (!plain) {
      toast.error("Nothing to read aloud")
      return
    }
    if (!ttsSupported) {
      toast.error("Read aloud is not supported in this browser")
      return
    }
    if (speaking) {
      stopSpeech()
      return
    }
    const started = await speak(plain)
    if (!started) {
      toast.error("Could not start read aloud")
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
        className={cn(actionBtn, speaking && "text-[#ff4f12]")}
        title={speaking ? "Stop" : "Listen"}
        aria-label={speaking ? "Stop read aloud" : "Listen to response"}
        onClick={() => void handleListen()}
        disabled={!plain}
      >
        {speaking ? <Square className="size-3.5 fill-current" /> : <Volume2 className="size-3.5" />}
      </button>
    </div>
  )
}
