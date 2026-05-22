"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const MAX_CHARS = 512_000

export function TextAssetViewer({
  fileUrl,
  filename,
  className,
}: {
  fileUrl: string
  filename: string
  className?: string
}) {
  const [content, setContent] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch(fileUrl, { credentials: "include" })
        if (!res.ok) {
          throw new Error(`Could not load file (${res.status})`)
        }
        const text = await res.text()
        if (cancelled) return
        if (text.length > MAX_CHARS) {
          setContent(text.slice(0, MAX_CHARS))
          setTruncated(true)
        } else {
          setContent(text)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load file")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [fileUrl])

  if (loading) {
    return (
      <div className={cn("flex h-full items-center justify-center", className)}>
        <Loader2 className="size-8 animate-spin text-zinc-500" />
      </div>
    )
  }

  if (error) {
    return (
      <p className={cn("flex h-full items-center justify-center px-6 text-sm text-zinc-500", className)}>
        {error}
      </p>
    )
  }

  return (
    <div className={cn("scrollbar-hide h-full overflow-auto bg-zinc-950", className)}>
      {truncated ? (
        <p className="sticky top-0 z-10 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[11px] text-amber-200/90">
          Showing first {MAX_CHARS.toLocaleString()} characters of {filename}.
        </p>
      ) : null}
      <pre className="min-h-full p-4 font-mono text-[12px] leading-relaxed text-zinc-200 whitespace-pre-wrap break-words">
        {content}
      </pre>
    </div>
  )
}
