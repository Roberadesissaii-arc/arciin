/**
 * A manuscript, read as a book rather than as markdown.
 *
 * The stored document does not change. `# Title`, `## Contents` and
 * `## Chapter 7: The Salt Circle` are exactly what the parser, the memory, the
 * validator and the recovery path all depend on, and putting presentation into
 * the source — centred lines made of spaces, tabs before paragraphs, banks of
 * blank lines — would break every one of them and pollute what the reader
 * copies. So the manuscript stays canonical and this reads it into semantic
 * blocks the renderer can lay out properly.
 *
 * The split matters beyond looks: a document that knows which block is a title,
 * a chapter opening, a scene break or body prose is a document that can be
 * exported to EPUB or PDF later without anyone re-parsing formatting hacks.
 */

import type { BookFormatProfile } from "./types"

export type BookBlock =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "author"; text: string }
  /** The premise paragraph that sits under the title, before Contents. */
  | { kind: "epigraph"; text: string }
  | { kind: "contents"; entries: Array<{ number: number; title: string }> }
  | { kind: "chapter"; number: number; title: string }
  | { kind: "subheading"; text: string; level: 3 | 4 }
  | { kind: "scene-break" }
  /** `opening` is true for the first paragraph of a chapter or after a break. */
  | { kind: "paragraph"; text: string; opening: boolean }
  | { kind: "blockquote"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }

export type BookDocument = {
  title: string
  subtitle?: string
  author?: string
  blocks: BookBlock[]
}

/** A scene break as models write it, and as books print it. */
const SCENE_BREAK = /^\s*(?:\*\s*\*\s*\*|\*{3,}|#{3,}\s*$|·\s*·\s*·)\s*$/

const CHAPTER_HEADING = /^#{1,3}[ \t]*chapter[ \t]+(\d+)[ \t]*[:.．—–-]?[ \t]*(.*)$/i
const CONTENTS_HEADING = /^#{1,3}\s*(?:table\s+of\s+)?contents\s*$/i

/**
 * Read the manuscript into blocks.
 *
 * Streaming-safe: a half-written chapter parses into the blocks it has so far,
 * so a chapter opening is laid out as a chapter opening while its prose is
 * still arriving rather than snapping into place when the book finishes.
 */
export function parseBookDocument(
  markdown: string,
  meta?: { subtitle?: string; author?: string },
): BookDocument {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n")
  const blocks: BookBlock[] = []

  let title = ""
  let seenTitle = false
  let inContents = false
  let contents: Array<{ number: number; title: string }> = []
  /** The next paragraph opens a chapter or follows a break, so it sits flush. */
  let nextIsOpening = true
  let paragraph: string[] = []
  let listItems: string[] = []
  let listOrdered = false

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const text = paragraph.join(" ").trim()
    paragraph = []
    if (!text) return
    // The premise paragraph belongs to the title page, not the body.
    if (seenTitle && blocks.every((b) => b.kind !== "contents" && b.kind !== "chapter")) {
      blocks.push({ kind: "epigraph", text })
      return
    }
    blocks.push({ kind: "paragraph", text, opening: nextIsOpening })
    nextIsOpening = false
  }

  const flushList = () => {
    if (listItems.length === 0) return
    blocks.push({ kind: "list", ordered: listOrdered, items: listItems })
    listItems = []
    nextIsOpening = false
  }

  const flushContents = () => {
    if (!inContents) return
    inContents = false
    if (contents.length > 0) blocks.push({ kind: "contents", entries: contents })
    contents = []
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      flushList()
      continue
    }

    if (SCENE_BREAK.test(trimmed) && seenTitle && !inContents) {
      flushParagraph()
      flushList()
      blocks.push({ kind: "scene-break" })
      // A book resets to flush-left after a break, the same as after a heading.
      nextIsOpening = true
      continue
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      flushParagraph()
      flushList()

      const level = heading[1]!.length
      const body = (heading[2] ?? "").trim()

      const chapter = trimmed.match(CHAPTER_HEADING)
      if (chapter) {
        flushContents()
        blocks.push({
          kind: "chapter",
          number: Number(chapter[1]),
          title: (chapter[2] ?? "").replace(/[*_`]/g, "").trim(),
        })
        nextIsOpening = true
        continue
      }

      if (CONTENTS_HEADING.test(trimmed)) {
        flushContents()
        inContents = true
        continue
      }

      flushContents()

      if (level === 1 && !seenTitle) {
        title = body.replace(/[*_`]/g, "")
        seenTitle = true
        blocks.push({ kind: "title", text: title })
        if (meta?.subtitle) blocks.push({ kind: "subtitle", text: meta.subtitle })
        if (meta?.author) blocks.push({ kind: "author", text: meta.author })
        continue
      }

      blocks.push({
        kind: "subheading",
        text: body.replace(/[*_`]/g, ""),
        level: level >= 4 ? 4 : 3,
      })
      nextIsOpening = true
      continue
    }

    if (inContents) {
      const entry = trimmed.match(/^(?:[-*]\s*)?(?:chapter\s*)?(\d+)\s*[.):—–-]\s*(.+)$/i)
      if (entry) {
        // The remit after the dash is the writing engine's, not the reader's:
        // "3. The Bell in the Lake — Mara discovers the first connection" is a
        // planning note, and printing it turns a Contents page into an outline.
        const rest = (entry[2] ?? "").trim()
        const titleOnly = rest.match(/^(.+?)\s+[—–]\s+/)?.[1] ?? rest
        contents.push({
          number: Number(entry[1]),
          title: titleOnly.replace(/[*_`]/g, "").trim(),
        })
        continue
      }
      // Anything else ends the Contents block.
      flushContents()
    }

    const quote = trimmed.match(/^>\s?(.*)$/)
    if (quote) {
      flushParagraph()
      flushList()
      blocks.push({ kind: "blockquote", text: quote[1] ?? "" })
      nextIsOpening = false
      continue
    }

    const bullet = trimmed.match(/^[-*+]\s+(.*)$/)
    const numbered = trimmed.match(/^(\d+)[.)]\s+(.*)$/)
    if (bullet || numbered) {
      flushParagraph()
      if (listItems.length === 0) listOrdered = Boolean(numbered)
      listItems.push((bullet?.[1] ?? numbered?.[2] ?? "").trim())
      continue
    }

    paragraph.push(trimmed)
  }

  flushParagraph()
  flushList()
  flushContents()

  return {
    title: title || "Untitled",
    subtitle: meta?.subtitle,
    author: meta?.author,
    blocks,
  }
}

const ONES = [
  "", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN",
  "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN", "SEVENTEEN",
  "EIGHTEEN", "NINETEEN",
]
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"]

/**
 * "CHAPTER FOUR", the way a book sets it.
 *
 * Falls back to the numeral past ninety-nine rather than growing a full
 * number-speller — a book with a hundredth chapter is better served by
 * "CHAPTER 100" than by a rule nobody will read.
 */
export function chapterNumberWord(n: number): string {
  if (!Number.isFinite(n) || n < 1) return String(n)
  if (n < 20) return ONES[n] ?? String(n)
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)]
    const rest = n % 10
    return rest ? `${tens}-${ONES[rest]}` : (tens ?? String(n))
  }
  return String(n)
}

/**
 * Guess how the book should be set, from what the reader asked for.
 *
 * Only a default. The profile lives on the project, so a reader who says
 * "a novel" gets fiction settings for every chapter without restating it.
 */
export function inferFormatProfile(brief: string): BookFormatProfile {
  const t = brief.toLowerCase()
  if (/\b(textbook|course|curriculum|workbook|exercises|syllabus)\b/.test(t)) return "textbook"
  if (
    /\b(novel|novella|story|stories|fiction|fantasy|thriller|mystery|romance|sci-?fi|saga|tale)\b/.test(
      t,
    )
  ) {
    return "fiction"
  }
  return "nonfiction"
}
