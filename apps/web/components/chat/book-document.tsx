"use client"

/**
 * A manuscript, set like a book.
 *
 * Everything here is presentation. The source stays canonical markdown, so what
 * the reader copies out is prose without a single leading space, and what the
 * parser reads back is the same document it wrote — the indentation, the
 * centring and the chapter breaks are all CSS.
 *
 * The blocks are semantic rather than visual for the same reason: a document
 * that knows a block is a chapter opening can be sent to PDF, EPUB or DOCX
 * later without anyone re-deriving that from spacing.
 */

import type React from "react"

import {
  chapterNumberWord,
  parseBookDocument,
  type BookBlock,
} from "@/lib/chat/book/book-document"
import type { BookFormatProfile } from "@/lib/chat/book/types"
import { cn } from "@/lib/utils"

/** Inline emphasis only. A manuscript has no links, code or tables in prose. */
function inline(text: string): React.ReactNode {
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_/g
  const nodes: React.ReactNode[] = []
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[1] !== undefined) nodes.push(<strong key={k++}>{m[1]}</strong>)
    else nodes.push(<em key={k++}>{m[2] ?? m[3]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length > 0 ? nodes : text
}

export function BookDocumentView({
  content,
  profile = "nonfiction",
  subtitle,
  author,
  className,
}: {
  content: string
  profile?: BookFormatProfile
  subtitle?: string
  author?: string
  className?: string
}) {
  const doc = parseBookDocument(content, { subtitle, author })

  // Fiction sets prose the traditional way: paragraphs run on, separated by a
  // first-line indent rather than a blank line. Non-fiction and textbooks keep
  // block paragraphs, because their paragraphs are units of argument and are
  // read in isolation more often than they are read in sequence.
  const indented = profile === "fiction"

  return (
    <div
      className={cn(
        "book-document mx-auto w-full",
        // A readable measure. Prose stretched across a wide panel is the single
        // most common way a manuscript stops reading like one.
        "max-w-[34rem]",
        "text-[15px] leading-[1.7] text-foreground",
        className,
      )}
    >
      {/* Indentation is CSS so copied text carries no leading whitespace. */}
      <style>{`
        .book-document .book-body { margin: 0; }
        .book-document .book-body + .book-body { margin-top: ${indented ? "0" : "0.9em"}; }
        .book-document .book-body.book-indent { text-indent: 1.3em; }
      `}</style>

      {doc.blocks.map((block, index) => (
        <Block key={index} block={block} indented={indented} profile={profile} />
      ))}
    </div>
  )
}

function Block({
  block,
  indented,
  profile,
}: {
  block: BookBlock
  indented: boolean
  profile: BookFormatProfile
}) {
  switch (block.kind) {
    case "title":
      return (
        <h1 className="book-title mt-6 text-balance text-center text-[1.9rem] font-semibold leading-[1.15] tracking-tight">
          {block.text}
        </h1>
      )

    case "subtitle":
      return (
        <p className="book-subtitle mt-3 text-center text-[0.95rem] italic text-muted-foreground">
          {block.text}
        </p>
      )

    case "author":
      return (
        <p className="book-author mt-6 text-center text-[0.85rem] uppercase tracking-[0.18em] text-muted-foreground">
          {block.text}
        </p>
      )

    case "epigraph":
      return (
        <p className="book-epigraph mx-auto mt-8 max-w-[26rem] text-center text-[0.92rem] italic leading-relaxed text-muted-foreground">
          {inline(block.text)}
        </p>
      )

    case "contents":
      return (
        // A generous rule above stands in for the page break a printed book
        // would take here; Canvas is continuous, so the break is structural.
        <section className="book-contents mt-16 border-t border-border/50 pt-10">
          <h2 className="mb-6 text-center text-[0.78rem] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
            Contents
          </h2>
          <ol className="space-y-2">
            {block.entries.map((entry) => (
              <li key={entry.number} className="flex gap-4 text-[0.95rem]">
                <span className="w-6 shrink-0 text-right tabular-nums text-muted-foreground">
                  {entry.number}
                </span>
                <span className="min-w-0">{entry.title}</span>
              </li>
            ))}
          </ol>
        </section>
      )

    case "chapter":
      return (
        <header
          className="book-chapter mt-20 mb-8 text-center first:mt-6"
          // The page break a printed chapter takes. Ignored on screen, honoured
          // by print and by any future PDF export.
          style={{ breakBefore: "page" }}
        >
          <p className="book-chapter-number text-[0.72rem] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
            Chapter {chapterNumberWord(block.number)}
          </p>
          {block.title ? (
            <h2 className="book-chapter-title mt-3 text-balance text-[1.3rem] font-semibold leading-snug tracking-tight">
              {block.title}
            </h2>
          ) : null}
        </header>
      )

    case "subheading":
      return block.level === 3 ? (
        <h3
          className={cn(
            "book-subheading mt-10 mb-3 text-[1.02rem] font-semibold tracking-tight",
            // Fiction rarely wants subheads; when one appears, it is set quietly
            // rather than as a document section.
            profile === "fiction" && "text-center font-normal italic text-muted-foreground",
          )}
        >
          {block.text}
        </h3>
      ) : (
        <h4 className="book-subheading mt-7 mb-2 text-[0.95rem] font-semibold">{block.text}</h4>
      )

    case "scene-break":
      return (
        <p
          className="book-scene-break my-7 text-center text-[0.9rem] tracking-[0.6em] text-muted-foreground"
          aria-hidden
        >
          * * *
        </p>
      )

    case "blockquote":
      return (
        <blockquote className="book-quote my-5 border-l-2 border-border pl-4 text-[0.95rem] italic text-muted-foreground">
          {inline(block.text)}
        </blockquote>
      )

    case "list":
      return block.ordered ? (
        <ol className="book-list my-4 list-decimal space-y-1.5 pl-6">
          {block.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul className="book-list my-4 list-disc space-y-1.5 pl-6">
          {block.items.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>
      )

    case "paragraph":
      return (
        <p
          className={cn(
            "book-body",
            // Flush left at a chapter opening and after a scene break, indented
            // everywhere else — the rhythm a printed book actually uses.
            indented && !block.opening && "book-indent",
          )}
        >
          {inline(block.text)}
        </p>
      )
  }
}
