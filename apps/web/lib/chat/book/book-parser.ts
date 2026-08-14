/**
 * Reading a book's structure back out of its manuscript.
 *
 * The manuscript is the source of truth, so every question about progress —
 * which chapters exist, what the book is called, where chapter seven starts —
 * is answered by parsing rather than by a counter. A counter and a document
 * disagree the moment the reader edits by hand, and then the orchestrator
 * writes a chapter that is already there.
 *
 * Pure. No storage, no React, no imports beyond the types.
 */

import type { BookChapter } from "./types"

/** Matches a chapter heading at any of the three levels models produce. */
const CHAPTER_HEADING = /^#{1,3}[ \t]*chapter[ \t]+(\d+)[ \t]*[:.．—–-]?[ \t]*(.*)$/gim

/**
 * Read the chapter list out of a draft.
 *
 * The contents list wins over the written headings when present, because it
 * describes chapters that do not exist yet — which is the entire reason the
 * plan is kept at all.
 */
export function parseBookOutline(markdown: string): BookChapter[] {
  const contents = markdown.match(
    /^#{1,3}\s*(?:table\s+of\s+)?contents\s*$([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/im,
  )

  if (contents?.[1]) {
    const rows: BookChapter[] = []
    for (const line of contents[1].split("\n")) {
      const row = line.match(/^\s*(?:[-*]\s*)?(?:chapter\s*)?(\d+)\s*[.):—–-]\s*(.+)$/i)
      if (!row) continue
      const number = Number(row[1])
      if (!Number.isFinite(number) || number < 1) continue

      // "The Salt Circle — discovers protective symbols" splits into the title
      // and the chapter's remit; a bare title leaves the remit empty.
      const rest = (row[2] ?? "").trim().replace(/\s*[|·]\s*/g, " — ")
      const split = rest.match(/^(.+?)\s+[—–]\s+(.+)$/)
      rows.push({
        number,
        title: (split?.[1] ?? rest).trim().replace(/[.*_`]+$/g, "").trim(),
        summary: (split?.[2] ?? "").trim(),
      })
    }
    if (rows.length >= 2) {
      // Deduplicate on number: a model that lists "7." twice must not create two
      // chapter sevens for the orchestrator to write.
      const byNumber = new Map<number, BookChapter>()
      for (const row of rows) if (!byNumber.has(row.number)) byNumber.set(row.number, row)
      return [...byNumber.values()].sort((a, b) => a.number - b.number)
    }
  }

  const headings: BookChapter[] = []
  const seen = new Set<number>()
  for (const m of markdown.matchAll(CHAPTER_HEADING)) {
    const number = Number(m[1])
    if (!Number.isFinite(number) || seen.has(number)) continue
    seen.add(number)
    headings.push({ number, title: (m[2] ?? "").trim(), summary: "" })
  }
  return headings.sort((a, b) => a.number - b.number)
}

/** Chapter numbers present in the manuscript, ascending and deduplicated. */
export function writtenChapterNumbers(markdown: string): number[] {
  const numbers = new Set<number>()
  for (const m of markdown.matchAll(CHAPTER_HEADING)) {
    const n = Number(m[1])
    if (Number.isFinite(n)) numbers.add(n)
  }
  return [...numbers].sort((a, b) => a - b)
}

/**
 * How far the manuscript actually runs.
 *
 * The length of the unbroken run from chapter one, not the count of headings.
 * A manuscript holding 1, 2, 3 and 7 is seven chapters long by count and three
 * chapters long in fact — resuming at eight would leave a hole nobody fills.
 * Resuming at four fills it.
 */
export function countChaptersWritten(markdown: string): number {
  const numbers = writtenChapterNumbers(markdown)
  let run = 0
  for (const n of numbers) {
    if (n === run + 1) run += 1
    else if (n > run + 1) break
  }
  return run
}

/** The book's own title, if it has named itself. */
export function parseBookTitle(markdown: string, fallback: string): string {
  const h1 = markdown.match(/^#\s+(.+)$/m)
  const title = h1?.[1]?.trim().replace(/[*_`]/g, "")
  if (!title) return fallback
  if (/^(?:table\s+of\s+)?contents$/i.test(title)) return fallback
  if (/^chapter\s+\d+\b/i.test(title)) return fallback
  return title.slice(0, 120)
}

/** The text of one chapter, heading included, or null when it is absent. */
export function extractChapter(markdown: string, chapter: number): string | null {
  const lines = markdown.split("\n")
  let start = -1
  let end = lines.length

  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i]!.match(/^#{1,3}[ \t]*chapter[ \t]+(\d+)\b/i)
    if (!m) continue
    const n = Number(m[1])
    if (n === chapter && start === -1) start = i
    else if (start !== -1) {
      end = i
      break
    }
  }
  if (start === -1) return null
  return lines.slice(start, end).join("\n").trim() || null
}

/**
 * Words of prose, ignoring markdown furniture and fenced code.
 *
 * Used for the progress card and for the length check in validation, so it has
 * to count what a reader would call words rather than tokens or symbols.
 */
export function countWords(markdown: string): number {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^#{1,6}\s+/gm, " ")
    .replace(/[#>*_~[\]()|]/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/**
 * "continue", and the handful of other ways a reader says it.
 *
 * Deliberately narrow, and unchanged from the manual implementation: it turns
 * an ordinary message into a book turn, so it must not fire on "continue the
 * analysis in section three", which is a different request that happens to
 * start with the same word. The length cap is what enforces that.
 */
export function isBookContinueRequest(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, "")
  if (!t || t.length > 48) return false
  return (
    /^(?:\/book\s+)?(?:continue|carry on|keep going|go on|next|more)$/.test(t) ||
    /^(?:please\s+)?(?:continue|keep)\s+(?:writing|going)$/.test(t) ||
    /^(?:write|do)\s+(?:the\s+)?next\s+chapter$/.test(t) ||
    /^next\s+chapter$/.test(t) ||
    /^(?:continue|keep\s+writing)\s+the\s+book$/.test(t)
  )
}

/**
 * Every tag the app asks the model to emit alongside a chapter.
 *
 * One list, used both to strip them and to read them, so a tag added to the
 * memory instruction cannot be forgotten here. That is precisely what went
 * wrong: the stripper knew about `next` and `chapter-summary` while the
 * instruction had grown `carry`, `thread-open` and `thread-resolved` — and
 * those three appeared in the middle of a real reader's manuscript.
 */
export const BOOK_CONTROL_TAGS = [
  "next",
  "chapter-summary",
  "carry",
  "thread-open",
  "thread-resolved",
] as const

const TAG_NAMES = BOOK_CONTROL_TAGS.join("|")

/**
 * Remove the control tags so only prose reaches the manuscript.
 *
 * Two passes, because a model does not quote reliably. The first takes the
 * well-formed `[carry:"..."]`; the second takes any *whole line* that opens
 * with a known tag and closes with a bracket, which catches a value containing
 * its own quotation marks — a real risk in a book, where dialogue is quoted.
 *
 * Deliberately conservative: it only ever deletes a line that is nothing but a
 * control tag, so a sentence that happens to contain a bracket is untouched.
 */
export function stripBookControlTags(markdown: string): string {
  const inline = new RegExp(`\\[(?:${TAG_NAMES})\\s*:\\s*"[^"]*"\\s*\\]`, "gi")
  const wholeLine = new RegExp(`^[ \\t]*\\[(?:${TAG_NAMES})\\s*:[\\s\\S]*\\][ \\t]*$`, "i")

  return markdown
    .replace(inline, "")
    .split("\n")
    .filter((line) => !wholeLine.test(line))
    .join("\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** True when any control tag survives — asserted after stripping. */
export function hasBookControlTags(markdown: string): boolean {
  return new RegExp(`\\[(?:${TAG_NAMES})\\s*:`, "i").test(markdown)
}
