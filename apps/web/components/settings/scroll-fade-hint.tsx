"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

export function ScrollFadeHint({
  children,
  className,
  innerClassName,
}: {
  children: ReactNode
  className?: string
  innerClassName?: string
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollDown, setCanScrollDown] = useState(false)

  const updateHint = useCallback(() => {
    const el = scrollRef.current
    if (!el) {
      setCanScrollDown(false)
      return
    }
    const hasOverflow = el.scrollHeight > el.clientHeight + 2
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
    setCanScrollDown(hasOverflow && !atBottom)
  }, [])

  useEffect(() => {
    updateHint()
    const el = scrollRef.current
    if (!el) {
      return
    }

    const observer = new ResizeObserver(updateHint)
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateHint, children])

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={scrollRef}
        onScroll={updateHint}
        className={cn(
          "scrollbar-hide min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl border border-border bg-muted/20 p-2",
          innerClassName,
        )}
      >
        {children}
      </div>
      {canScrollDown ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center justify-end pb-1 pt-6"
          aria-hidden
        >
          <div className="absolute inset-x-0 bottom-0 h-14 rounded-b-xl bg-gradient-to-t from-background via-background/85 to-transparent" />
          <ChevronDown className="relative size-4 animate-bounce text-zinc-400" />
        </div>
      ) : null}
    </div>
  )
}
