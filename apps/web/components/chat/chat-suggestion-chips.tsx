"use client"

import type { ChatSuggestion } from "@arciin/shared"

import { cn } from "@/lib/utils"

/**
 * A row of suggested prompts.
 *
 * Clicking fills the composer instead of sending. A one-click send that guesses
 * wrong costs a whole generation and leaves the reader undoing it, so the chip
 * gets them to a starting point and hands back control — they can edit the
 * wording, add a filename, or ignore it entirely.
 */
export function ChatSuggestionChips({
  suggestions,
  onPick,
  label,
  className,
}: {
  suggestions: ChatSuggestion[]
  onPick: (suggestion: ChatSuggestion) => void
  /** Optional lead-in, e.g. "Try". Omitted for the follow-up row. */
  label?: string
  className?: string
}) {
  if (suggestions.length === 0) return null

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {label ? (
        <span className="text-[11px] text-muted-foreground">{label}</span>
      ) : null}
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.id}
          type="button"
          onClick={() => onPick(suggestion)}
          title={suggestion.prompt}
          className={cn(
            "rounded-full border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground",
            "transition-colors hover:border-primary/40 hover:bg-primary/[0.06] hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          )}
        >
          {suggestion.label}
        </button>
      ))}
    </div>
  )
}
