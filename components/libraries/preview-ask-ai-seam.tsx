"use client"

import { ChevronRight, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"

const TAB =
  "flex flex-col items-center justify-center gap-1.5 rounded-l-2xl border border-r-0 border-white/10 bg-zinc-950/75 py-3.5 pl-2.5 pr-2 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-colors hover:border-[#ff4f12]/40 hover:bg-zinc-950/90"

/**
 * Vertical tab on the right edge of the preview pane (seam before Ask AI panel).
 */
export function PreviewAskAiSeam({
  open,
  onOpen,
  onClose,
}: {
  open: boolean
  onOpen: () => void
  onClose: () => void
}) {
  return (
    <button
      type="button"
      onClick={open ? onClose : onOpen}
      className={cn(
        TAB,
        "absolute right-0 top-1/2 z-40 -translate-y-1/2",
        open ? "w-8" : "min-w-[2.85rem]",
      )}
      aria-label={open ? "Collapse Ask AI" : "Open Ask AI"}
      title={open ? "Collapse Ask AI" : "Ask AI"}
    >
      {open ? (
        <ChevronRight className="size-4 text-zinc-400" />
      ) : (
        <>
          <Sparkles className="size-4 text-[#ff4f12]" />
          <span
            className="text-[10px] font-semibold tracking-wide text-zinc-300 [writing-mode:vertical-rl]"
            style={{ textOrientation: "mixed" }}
          >
            Ask AI
          </span>
        </>
      )}
    </button>
  )
}
