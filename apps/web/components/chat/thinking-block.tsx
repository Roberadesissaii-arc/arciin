"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronDown, Loader2, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"

/** Collapsible live reasoning trace shown above assistant replies. */
export function ThinkingBlock({ content, live }: { content: string; live: boolean }) {
  const [expanded, setExpanded] = useState(true)
  const [prevLive, setPrevLive] = useState(live)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** If true, new tokens keep the view pinned to the bottom; false after user scrolls up to read. */
  const stickToBottomRef = useRef(true)

  // React "adjusting state during render": auto-expand when live starts.
  if (live && !prevLive) {
    setPrevLive(true)
    setExpanded(true)
  } else if (!live && prevLive) {
    setPrevLive(false)
  }

  // Reset scroll-pin ref outside of render (in a layout effect) so the ref write is safe.
  useEffect(() => {
    if (live) stickToBottomRef.current = true
  }, [live])

  const charCount = content.length
  const showBody = expanded && (content.length > 0 || live)

  function onScrollBody() {
    const el = scrollRef.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = gap < 72
  }

  useLayoutEffect(() => {
    if (!showBody) return
    const el = scrollRef.current
    if (!el) return
    // `live` used to force a scroll-to-bottom here, which meant that while the
    // model was still thinking you physically could not read the earlier
    // reasoning: every token yanked the box back down. Whether to follow is the
    // reader's choice, not the stream's — so the pin flag decides in both
    // states, and it re-pins on its own once you scroll back to the bottom.
    if (!stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [content, live, showBody])

  return (
    <div className="mb-2 overflow-hidden rounded-xl border border-border/50 bg-muted/20 text-[12px]">
      <button
        type="button"
        onClick={() => { setExpanded((v) => !v) }}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {live ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-primary/70" />
        ) : (
          <Sparkles className="size-3 shrink-0 text-primary/40" />
        )}
        <span className="flex-1 text-[11px] font-medium text-muted-foreground">
          {live ? (
            <>
              Reasoning trace
              {charCount > 0 ? (
                <span className="ml-1.5 tabular-nums text-muted-foreground/70">· {charCount.toLocaleString()} chars</span>
              ) : null}
            </>
          ) : (
            "Reasoning"
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-3 shrink-0 text-muted-foreground/40 transition-transform",
            expanded ? "rotate-180" : "rotate-0",
          )}
        />
      </button>
      {showBody && (
        <div className="border-t border-border/30 px-3 py-2.5">
          <div
            ref={scrollRef}
            onScroll={onScrollBody}
            className="max-h-[min(40vh,320px)] overflow-y-auto text-[11px] leading-relaxed text-muted-foreground/80 scrollbar-hide"
          >
            {content ? (
              <p className="whitespace-pre-wrap">{content}</p>
            ) : live ? (
              <p className="italic text-muted-foreground/60">Waiting for reasoning trace…</p>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
