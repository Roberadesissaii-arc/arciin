"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"

import { SyntaxHighlightedCode } from "@/components/libraries/syntax-highlighted-code"
import { highlightLanguageFromFilename } from "@/lib/files/code-highlight-language"
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

  const language = useMemo(() => highlightLanguageFromFilename(filename), [filename])
  const isCode = language !== "plaintext"

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
      <div
        className={cn(
          "flex h-full min-h-0 items-center justify-center rounded-xl border border-zinc-700/50 bg-zinc-50",
          className,
        )}
      >
        <Loader2 className="size-8 animate-spin text-zinc-500" />
      </div>
    )
  }

  if (error) {
    return (
      <p
        className={cn(
          "flex h-full min-h-0 items-center justify-center rounded-xl border border-zinc-700/50 bg-zinc-50 px-6 text-sm text-zinc-600",
          className,
        )}
      >
        {error}
      </p>
    )
  }

  return (
    <div
      className={cn(
        "scrollbar-hide flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-700/50 bg-zinc-50 shadow-sm",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200/90 bg-zinc-100/80 px-4 py-2">
        <span className="truncate font-mono text-[11px] font-medium text-zinc-600">{filename}</span>
        {isCode ? (
          <span className="shrink-0 rounded-md bg-zinc-200/80 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
            {language}
          </span>
        ) : null}
      </div>
      {truncated ? (
        <p className="shrink-0 border-b border-amber-200/80 bg-amber-50 px-4 py-2 text-[11px] text-amber-900/90">
          Showing first {MAX_CHARS.toLocaleString()} characters of {filename}.
        </p>
      ) : null}
      <div className="scrollbar-hide min-h-0 flex-1 overflow-auto">
        {content != null && isCode ? (
          <SyntaxHighlightedCode code={content} language={language} />
        ) : (
          <pre className="m-0 p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words text-zinc-800">
            {content}
          </pre>
        )}
      </div>
    </div>
  )
}
