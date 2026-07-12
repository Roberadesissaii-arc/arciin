"use client"

import { useEffect, useState } from "react"

import { highlightCodeToHtml } from "@/lib/shiki/client-highlighter"
import { cn } from "@/lib/utils"

export function SyntaxHighlightedCode({
  code,
  language,
  className,
}: {
  code: string
  language: string
  className?: string
}) {
  const cacheKey = `${language}\0${code}`
  const [highlight, setHighlight] = useState<{ key: string; html: string } | null>(
    null,
  )

  useEffect(() => {
    let cancelled = false
    void highlightCodeToHtml(code, language).then((result) => {
      if (!cancelled) setHighlight({ key: cacheKey, html: result })
    })
    return () => {
      cancelled = true
    }
  }, [cacheKey, code, language])

  const html = highlight?.key === cacheKey ? highlight.html : null

  if (!html) {
    return (
      <pre
        className={cn(
          "m-0 p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap break-words text-zinc-800",
          className,
        )}
      >
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className={cn("syntax-highlighted-code min-w-0", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
