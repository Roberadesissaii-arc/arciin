"use client"

import { AlertTriangle, Clock, Loader2, MessageSquare, Pause, Plus, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ChatConversationSummary } from "@/lib/api/chat"
import { relTime } from "@/components/chat/chat-format"
import { useBookRuns } from "@/hooks/use-book-runs"
import { describeBookRun, isBookRunActive, type BookRunView } from "@/lib/api/book-runs"

const ACCENT = "var(--arciin-accent, #ff4f12)"

/**
 * The live state of a book, on the row it belongs to.
 *
 * Deliberately the same two lines the row already had — a status where the
 * preview goes, and nothing else. The container, the widths, the type scale and
 * the delete gutter are untouched; a running book earns a spinner and a hairline
 * of progress, not a card.
 *
 * Server-backed, so a book running on another computer shows here too.
 */
function BookRunLine({ run }: { run: BookRunView }) {
  if (isBookRunActive(run.status)) {
    const percent =
      run.totalChapters > 0
        ? Math.min(100, Math.round((run.writtenChapters / run.totalChapters) * 100))
        : 0
    return (
      <>
        <p className="mt-1 flex items-center gap-1.5 truncate text-[11px]" style={{ color: ACCENT }}>
          <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
          <span className="truncate">{describeBookRun(run)}</span>
        </p>
        {run.totalChapters > 0 ? (
          <div className="mt-1 h-[2px] w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ background: ACCENT, width: `${percent}%` }}
            />
          </div>
        ) : null}
      </>
    )
  }

  if (run.status === "PAUSED" || run.status === "INTERRUPTED") {
    return (
      <p className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
        <Pause className="size-3 shrink-0" aria-hidden />
        <span className="truncate">
          {run.status === "PAUSED" ? "Paused" : "Interrupted"} ·{" "}
          {run.writtenChapters} / {run.totalChapters || "?"}
        </span>
      </p>
    )
  }

  if (run.status === "FAILED") {
    return (
      <p className="mt-1 flex items-center gap-1.5 truncate text-[11px] text-destructive">
        <AlertTriangle className="size-3 shrink-0" aria-hidden />
        <span className="truncate">Failed at Chapter {run.currentChapter}</span>
      </p>
    )
  }

  // Completed rows go back to ordinary conversation styling — no spinner, no
  // bar. The caller falls through to the normal preview line.
  return null
}

/**
 * The preview line is the latest message, which is usually the assistant's
 * markdown. Rendered raw it reads as "**Main differences between TCP…", so the
 * syntax is stripped down to the words.
 */
function previewText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/\|/g, " ")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/\[\[[^\]]*\]\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// ── History sidebar ────────────────────────────────────────────────────────────

export function HistorySidebar({
  conversations,
  activeId,
  loadingId,
  loading,
  onSelect,
  onNew,
  onDelete,
}: {
  conversations: ChatConversationSummary[]
  activeId: string | null
  loadingId: string | null
  loading: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}) {
  // One shared query with the sidebar indicator, so History and the nav can
  // never disagree about what is running.
  const { runs } = useBookRuns()
  const runByConversation = new Map(runs.map((r) => [r.conversationId, r]))

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-3">
        <span className="text-[12px] font-semibold text-foreground">History</span>
        <button
          type="button"
          onClick={onNew}
          className="flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted/60"
        >
          <Plus className="size-3.5" />
          New
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 scrollbar-hide">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Clock className="size-5 text-muted-foreground/50" />
            <p className="text-[12px] text-muted-foreground">No past conversations</p>
          </div>
        ) : (
          conversations.map((convo) => {
            const active = convo.id === activeId
            const preview = previewText(convo.messages[0]?.content ?? "").slice(0, 80)
            const run = runByConversation.get(convo.id)
            // A finished book is just a conversation again.
            const runLine = run && run.status !== "COMPLETED" ? <BookRunLine run={run} /> : null
            return (
              <div
                key={convo.id}
                // A stable hook for the cross-device suite, which has to find
                // one specific conversation's row and read its live status.
                data-conversation-id={convo.id}
                className={cn(
                  "group relative mb-1.5 cursor-pointer rounded-lg px-3 py-2.5 transition-colors",
                  active
                    ? "bg-primary/[0.08] ring-1 ring-primary/20"
                    : "hover:bg-muted/60",
                )}
                onClick={() => onSelect(convo.id)}
              >
                <div className="flex items-start gap-2.5">
                  {loadingId === convo.id || (run && isBookRunActive(run.status)) ? (
                    <Loader2
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0 animate-spin",
                        // A book run is orange; an ordinary loading row keeps
                        // the primary colour it always had.
                        !(run && isBookRunActive(run.status)) && "text-primary",
                      )}
                      style={run && isBookRunActive(run.status) ? { color: ACCENT } : undefined}
                    />
                  ) : (
                    <MessageSquare
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        active ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    {/* Reserve the delete button's width so a long title wraps
                        beside it instead of running underneath it. */}
                    <p
                      className={cn(
                        "line-clamp-2 pr-7 text-[12px] font-medium leading-snug",
                        active ? "text-primary" : "text-foreground",
                      )}
                    >
                      {convo.title}
                    </p>
                    {runLine ??
                      (preview ? (
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">{preview}</p>
                      ) : null)}
                    <p className="mt-1.5 text-[10px] text-muted-foreground/60">
                      {relTime(convo.updatedAt)}
                    </p>
                  </div>
                </div>

                {/* Delete — sits in the gutter reserved above, revealed on hover
                    and whenever the row has keyboard focus. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(convo.id)
                  }}
                  className="absolute right-2 top-2 rounded-lg p-1.5 text-muted-foreground/50 opacity-0 transition-[opacity,color,background-color] hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Delete conversation: ${convo.title}`}
                  title="Delete conversation"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
