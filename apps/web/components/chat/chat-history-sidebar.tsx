"use client"

import { Clock, Loader2, MessageSquare, Plus, Trash2 } from "lucide-react"

import { cn } from "@/lib/utils"
import type { ChatConversationSummary } from "@/lib/api/chat"
import { relTime } from "@/components/chat/chat-format"

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
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5 scrollbar-hide">
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
            const preview = convo.messages[0]?.content.slice(0, 80) ?? ""
            return (
              <div
                key={convo.id}
                className={cn(
                  "group relative mb-0.5 cursor-pointer rounded-xl px-2.5 py-2 transition-colors",
                  active ? "bg-primary/[0.08] ring-1 ring-primary/20" : "hover:bg-muted/60",
                )}
                onClick={() => onSelect(convo.id)}
              >
                <div className="flex items-start gap-2">
                  {loadingId === convo.id
                    ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" />
                    : <MessageSquare className={cn("mt-0.5 size-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                  }
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-[12px] font-medium", active ? "text-primary" : "text-foreground")}>
                      {convo.title}
                    </p>
                    {preview && (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{preview}</p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground/60">{relTime(convo.updatedAt)}</p>
                  </div>
                </div>

                {/* Delete button — appears on hover */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(convo.id) }}
                  className="absolute right-2 top-2 hidden rounded-lg p-1 text-muted-foreground/50 transition-colors hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                  title="Delete conversation"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
