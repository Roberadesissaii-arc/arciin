"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2 } from "lucide-react"

import { MarkdownContent } from "@/components/chat/chat-markdown"
import { SyntaxHighlightedCode } from "@/components/libraries/syntax-highlighted-code"
import { highlightLanguageFromFilename } from "@/lib/files/code-highlight-language"
import { cn } from "@/lib/utils"

const MAX_CHARS = 512_000

function isMarkdownFilename(filename: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(filename)
}

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
  const isMarkdown = isMarkdownFilename(filename)
  const isCode = !isMarkdown && language !== "plaintext"

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
        {isMarkdown ? (
          <span className="shrink-0 rounded-md bg-zinc-200/80 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
            markdown
          </span>
        ) : isCode ? (
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
      <div className="scrollbar-hide min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {content != null && isMarkdown ? (
          <article className="prose prose-zinc mx-auto max-w-3xl px-5 py-6 text-[14px] leading-relaxed text-zinc-800 prose-headings:scroll-mt-4 prose-headings:font-semibold prose-h1:text-[1.5rem] prose-h2:text-[1.15rem] prose-p:my-3 prose-p:leading-[1.7] prose-li:my-1">
            <MarkdownContent content={content} />
          </article>
        ) : content != null && isCode ? (
          <SyntaxHighlightedCode code={content} language={language} />
        ) : (
          <pre className="m-0 max-w-full whitespace-pre-wrap break-words p-4 font-sans text-[14px] leading-[1.7] text-zinc-800">
            {content}
          </pre>
        )}
      </div>
    </div>
  )
}
