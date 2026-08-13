"use client"

import { Copy, Eraser, Loader2, PenLine, Save, X } from "lucide-react"

import { copyToClipboard } from "@/lib/utils/clipboard"

import { CanvasMarkdownContent } from "@/components/chat/chat-canvas-markdown"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ChatCanvasPanelProps = {
  title: string
  content: string
  streaming?: boolean
  saving?: boolean
  onClose: () => void
  onSave?: () => void
  /** Clear draft body (keeps panel open). */
  onClear?: () => void
  /** Render the draft in the assistant's handwriting face. */
  handwriting?: boolean
  onToggleHandwriting?: () => void
  className?: string
}

/**
 * Side panel for long-form writing (essays, drafts) while chat shows progress.
 * Medium-rounded edges; full-height when parent is full-height.
 */
export function ChatCanvasPanel({
  title,
  content,
  streaming = false,
  saving = false,
  onClose,
  onSave,
  onClear,
  handwriting = false,
  onToggleHandwriting,
  className,
}: ChatCanvasPanelProps) {
  const handleCopy = async () => {
    const text = content.trim()
    if (!text) return
    // `navigator.clipboard` only exists in a secure context. Arciin is normally
    // reached over plain HTTP on a LAN address, where the API is simply
    // undefined — so the button threw and reported "Could not copy" every time.
    // The shared helper falls back to a hidden textarea + execCommand.
    await copyToClipboard(text, "Draft")
  }

  const canSave = Boolean(onSave && content.trim() && !streaming && !saving)
  const canClear = Boolean(onClear && content.trim() && !streaming)

  return (
    <aside
      className={cn(
        // Slightly tighter right radius when the panel sits flush against the window edge.
        "flex h-full min-h-0 w-full flex-col overflow-hidden rounded-l-xl rounded-r-lg border border-border bg-card shadow-sm",
        className,
      )}
      aria-label="Canvas"
    >
      <header className="flex shrink-0 items-center gap-1.5 border-b border-border py-2.5 pl-3 pr-1.5 sm:gap-2 sm:pr-2">
        <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <PenLine className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-foreground" title={title}>
            {title || "Canvas"}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {streaming ? "Writing…" : content.trim() ? "Draft ready" : "Empty"}
          </p>
        </div>
        {onSave ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold"
            disabled={!canSave}
            onClick={() => onSave()}
            aria-label="Save to Documents"
            title="Save to Documents"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            <span className="hidden sm:inline">{saving ? "Saving…" : "Save"}</span>
          </Button>
        ) : null}
        {onClear ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 shrink-0 gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-muted-foreground"
            disabled={!canClear}
            onClick={() => onClear()}
            aria-label="Clear canvas"
            title="Clear draft"
          >
            <Eraser className="size-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </Button>
        ) : null}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 rounded-lg"
          disabled={!content.trim()}
          onClick={() => void handleCopy()}
          aria-label="Copy canvas"
          title="Copy"
        >
          <Copy className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 rounded-lg"
          onClick={onClose}
          aria-label="Close canvas"
          title="Close"
        >
          <X className="size-3.5" />
        </Button>
      </header>

      {/* Left padding keeps prose readable; right stays tighter so the panel doesn’t look empty. */}
      <div className="min-h-0 flex-1 overflow-y-auto py-3 pl-3.5 pr-2 scrollbar-thin sm:pl-4 sm:pr-2.5">
        {!content.trim() && streaming ? (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" />
            Writing in Canvas…
          </div>
        ) : !content.trim() ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Turn on <span className="font-semibold text-foreground">Canvas</span> and ask for an
            essay, draft, or long write-up. Lists and short answers stay in chat; only writing opens
            here. Save sends the draft to{" "}
            <span className="font-semibold text-foreground">Documents</span>.
          </p>
        ) : (
          <div
            className="max-w-none"
            // The same face the assistant writes with on a PDF page. Applied to
            // the panel rather than to the text, so the draft itself is
            // untouched: what is saved, copied or exported is the same
            // document either way, and switching back costs nothing.
            style={
              handwriting
                ? {
                    fontFamily: 'var(--font-caveat), "Segoe Print", cursive',
                    fontSize: "1.18em",
                    lineHeight: 1.5,
                    letterSpacing: "0.01em",
                  }
                : undefined
            }
          >
            <CanvasMarkdownContent content={content} />
            {streaming ? (
              <span
                className="ml-0.5 inline-block h-[1em] w-0.5 translate-y-px animate-pulse bg-primary/80 align-middle"
                aria-hidden
              />
            ) : null}
          </div>
        )}
      </div>
    </aside>
  )
}
