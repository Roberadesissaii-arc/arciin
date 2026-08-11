"use client"

/**
 * Document-oriented markdown for Canvas (essays, docs, exams, outlines).
 * Proper heading hierarchy, readable prose, soft lists — not terminal-style.
 */

import type React from "react"
import { extractBlockMath, readMathBlockPlaceholder, stripAssistantStreamMarkup } from "@arciin/shared"
import { MathBlock, renderInlineWithMath } from "@/components/chat/math"
import { cn } from "@/lib/utils"

function parseInlineText(text: string): React.ReactNode {
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g
  const nodes: React.ReactNode[] = []
  let last = 0
  let k = 0
  let m: RegExpExecArray | null

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      nodes.push(
        <strong key={k++} className="font-semibold text-foreground">
          {m[1]}
        </strong>,
      )
    } else if (m[2] !== undefined) {
      nodes.push(<em key={k++}>{m[2]}</em>)
    } else if (m[3] !== undefined) {
      nodes.push(
        <code
          key={k++}
          className="rounded-md border border-border/60 bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground"
        >
          {m[3]}
        </code>,
      )
    } else if (m[4] !== undefined && m[5] !== undefined) {
      const href = m[5]
      const isInternal = href.startsWith("/")
      nodes.push(
        <a
          key={k++}
          href={href}
          target={isInternal ? "_self" : "_blank"}
          rel={isInternal ? undefined : "noopener noreferrer"}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          {m[4]}
        </a>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length === 1 ? nodes[0] : nodes
}

/**
 * Inline markdown, with LaTeX spans rendered by KaTeX.
 *
 * Math is split out first and the remaining runs go through the existing
 * emphasis/code/link parser unchanged, so `\(x^2\)` renders as maths while
 * everything else keeps behaving exactly as it did.
 */
function parseInline(text: string): React.ReactNode {
  return renderInlineWithMath(text, parseInlineText)
}

const HEADING_CLASS: Record<number, string> = {
  1: "mb-3 mt-0 text-[1.35rem] font-bold leading-snug tracking-tight text-foreground first:mt-0",
  2: "mb-2 mt-6 border-b border-border/60 pb-1.5 text-[1.05rem] font-semibold leading-snug text-foreground",
  3: "mb-1.5 mt-5 text-[0.95rem] font-semibold leading-snug text-foreground",
  4: "mb-1 mt-4 text-[0.9rem] font-semibold leading-snug text-foreground",
  5: "mb-1 mt-3 text-[0.85rem] font-semibold text-foreground",
  6: "mb-1 mt-3 text-[0.8rem] font-semibold uppercase tracking-wide text-muted-foreground",
}

/**
 * Soft code block: only look "terminal" when language is a programming one.
 * Plain ``` or markdown/text fences render as soft callouts (for docs).
 */
function isProgrammingLang(lang: string): boolean {
  return /^(js|ts|tsx|jsx|py|python|go|rs|rust|java|c|cpp|cs|rb|php|sh|bash|zsh|sql|json|yaml|yml|toml|html|css|swift|kt|kotlin)$/i.test(
    lang.trim(),
  )
}

export function CanvasMarkdownContent({
  content,
  className,
}: {
  content: string
  className?: string
}) {
  const cleaned = stripAssistantStreamMarkup(content)
  // Display equations are lifted out first so the line-based loop below never
  // has to deal with a construct that spans lines. Each becomes one
  // placeholder line, and unclosed math (mid-stream) stays as ordinary text.
  const { text: withMathPlaceholders, blocks: mathBlocks } = extractBlockMath(cleaned)
  const lines = withMathPlaceholders.split("\n")
  const nodes: React.ReactNode[] = []
  const listItems: { text: string; ordered: boolean }[] = []
  let inCode = false
  let codeLang = ""
  const codeLines: string[] = []
  let k = 0

  function flushList() {
    if (!listItems.length) return
    const ordered = listItems[0]!.ordered
    const items = listItems.splice(0)
    nodes.push(
      ordered ? (
        <ol key={k++} className="my-3 list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed">
          {items.map((it, i) => (
            <li key={i} className="pl-0.5">
              {parseInline(it.text)}
            </li>
          ))}
        </ol>
      ) : (
        <ul key={k++} className="my-3 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed">
          {items.map((it, i) => (
            <li key={i} className="pl-0.5">
              {parseInline(it.text)}
            </li>
          ))}
        </ul>
      ),
    )
  }

  function flushCode() {
    if (!codeLines.length && !inCode) return
    const body = codeLines.join("\n").replace(/\n+$/, "")
    codeLines.length = 0
    if (!body.trim()) return
    const prog = isProgrammingLang(codeLang)
    if (prog) {
      nodes.push(
        <div
          key={k++}
          className="my-3 overflow-hidden rounded-xl border border-border bg-zinc-950 shadow-sm"
        >
          {codeLang ? (
            <div className="border-b border-zinc-800 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
              {codeLang}
            </div>
          ) : null}
          <pre className="overflow-x-auto px-3 py-3">
            <code className="block font-mono text-[12px] leading-relaxed text-zinc-100 whitespace-pre">
              {body}
            </code>
          </pre>
        </div>,
      )
    } else {
      // Documentation callout — not a terminal
      nodes.push(
        <div
          key={k++}
          className="my-3 rounded-xl border border-border bg-muted/40 px-3.5 py-3 text-[13px] leading-relaxed text-foreground"
        >
          {body.split("\n").map((ln, i) => (
            <p key={i} className={cn("m-0", i > 0 && "mt-1.5")}>
              {parseInline(ln)}
            </p>
          ))}
        </div>,
      )
    }
  }

  for (const line of lines) {
    const fence = line.match(/^```([a-zA-Z0-9+#._-]*)\s*$/)
    if (fence) {
      if (!inCode) {
        flushList()
        inCode = true
        codeLang = fence[1] || ""
        codeLines.length = 0
      } else {
        inCode = false
        flushCode()
        codeLang = ""
      }
      continue
    }
    if (inCode) {
      codeLines.push(line)
      continue
    }

    const mathIndex = readMathBlockPlaceholder(line)
    if (mathIndex !== null && mathBlocks[mathIndex] !== undefined) {
      flushList()
      nodes.push(<MathBlock key={k++} latex={mathBlocks[mathIndex]!} />)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    const hr = /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())
    const ul = line.match(/^[-*+]\s+(.+)/)
    const ol = line.match(/^\d+[.)]\s+(.+)/)
    const bq = line.match(/^>\s?(.*)$/)

    if (heading) {
      flushList()
      const level = Math.min(6, heading[1]!.length) as 1 | 2 | 3 | 4 | 5 | 6
      const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
      nodes.push(
        <Tag key={k++} className={HEADING_CLASS[level]}>
          {parseInline(heading[2]!)}
        </Tag>,
      )
      continue
    }

    if (hr) {
      flushList()
      nodes.push(<hr key={k++} className="my-4 border-border" />)
      continue
    }

    if (ul) {
      if (listItems[0]?.ordered) flushList()
      listItems.push({ text: ul[1]!, ordered: false })
      continue
    }

    if (ol) {
      if (listItems[0] && !listItems[0].ordered) flushList()
      listItems.push({ text: ol[1]!, ordered: true })
      continue
    }

    if (bq) {
      flushList()
      nodes.push(
        <blockquote
          key={k++}
          className="my-3 border-l-2 border-primary/40 pl-3 text-[13px] leading-relaxed text-muted-foreground"
        >
          {parseInline(bq[1] || "")}
        </blockquote>,
      )
      continue
    }

    if (line.trim() === "") {
      flushList()
      continue
    }

    flushList()
    nodes.push(
      <p key={k++} className="my-2.5 text-[13.5px] leading-[1.7] text-foreground">
        {parseInline(line)}
      </p>,
    )
  }

  if (inCode) flushCode()
  flushList()

  return <div className={cn("canvas-doc max-w-none", className)}>{nodes}</div>
}
