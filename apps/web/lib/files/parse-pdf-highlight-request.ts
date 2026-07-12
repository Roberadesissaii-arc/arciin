import type { PdfPageLabel } from "@arciin/shared"
import { findPdfPageForPrintedPage } from "@arciin/shared"

import type { PdfHighlightTarget } from "@/lib/files/pdf-highlight-types"

/** Highlight on the page the user is currently viewing. */
const HIGHLIGHT_CURRENT_TAG =
  /\[highlight-current:(?:"([^"]*)"|'([^']*)'|([^\]\n]+))\]/gi

/** Section heading / named phrase on the current page. */
const HIGHLIGHT_HEADING_TAG =
  /\[highlight-heading:(?:"([^"]*)"|'([^']*)'|([^\]\n]+))\]/gi

/** Highlight on the PDF page that matches a printed/book page number. */
const HIGHLIGHT_PRINTED_TAG =
  /\[highlight-printed:(\d{1,4}):(?:"([^"]*)"|'([^']*)'|([^\]\n]+))\]/gi

/** Highlight on PDF page N (file index, not printed page). */
const HIGHLIGHT_PDF_TAG =
  /\[highlight:(\d{1,4}):(?:"([^"]*)"|'([^']*)'|([^\]\n]+))\]/gi

const ALL_HIGHLIGHT_TAGS = new RegExp(
  HIGHLIGHT_CURRENT_TAG.source +
    "|" +
    HIGHLIGHT_HEADING_TAG.source +
    "|" +
    HIGHLIGHT_PRINTED_TAG.source +
    "|" +
    HIGHLIGHT_PDF_TAG.source,
  "gi",
)

export type ParseHighlightOptions = {
  maxPage?: number
  /** PDF page the user is viewing — used for [highlight-current:…]. */
  currentPdfPage?: number
  pageIndex?: PdfPageLabel[]
}

function clampPage(page: number, maxPage?: number): number {
  if (!Number.isFinite(page) || page < 1) return 1
  if (maxPage && maxPage > 0) return Math.min(page, maxPage)
  return page
}

function pushHighlight(
  out: PdfHighlightTarget[],
  seen: Set<string>,
  page: number,
  quote: string,
  maxPage?: number,
  kind: PdfHighlightTarget["kind"] = "default",
) {
  const trimmed = quote.trim()
  if (!trimmed) return
  const clamped = clampPage(page, maxPage)
  const key = `${kind ?? "default"}:${clamped}:${trimmed.toLowerCase()}`
  if (seen.has(key)) return
  seen.add(key)
  out.push({ page: clamped, quote: trimmed, kind })
}

export function parseAssistantHighlights(
  text: string,
  options?: ParseHighlightOptions | number,
): PdfHighlightTarget[] {
  const opts: ParseHighlightOptions =
    typeof options === "number" ? { maxPage: options } : (options ?? {})
  const { maxPage, currentPdfPage, pageIndex } = opts
  const out: PdfHighlightTarget[] = []
  const seen = new Set<string>()

  let m: RegExpExecArray | null

  HIGHLIGHT_HEADING_TAG.lastIndex = 0
  while ((m = HIGHLIGHT_HEADING_TAG.exec(text)) !== null) {
    const quote = (m[1] ?? m[2] ?? m[3] ?? "").trim()
    if (currentPdfPage && currentPdfPage > 0) {
      pushHighlight(out, seen, currentPdfPage, quote, maxPage, "heading")
    }
  }

  HIGHLIGHT_CURRENT_TAG.lastIndex = 0
  while ((m = HIGHLIGHT_CURRENT_TAG.exec(text)) !== null) {
    const quote = (m[1] ?? m[2] ?? m[3] ?? "").trim()
    if (currentPdfPage && currentPdfPage > 0) {
      pushHighlight(out, seen, currentPdfPage, quote, maxPage, "default")
    }
  }

  HIGHLIGHT_PRINTED_TAG.lastIndex = 0
  while ((m = HIGHLIGHT_PRINTED_TAG.exec(text)) !== null) {
    const printed = Number.parseInt(m[1]!, 10)
    const quote = (m[2] ?? m[3] ?? m[4] ?? "").trim()
    if (!Number.isFinite(printed) || !pageIndex?.length) continue
    const pdf = findPdfPageForPrintedPage(pageIndex, printed)
    if (pdf) pushHighlight(out, seen, pdf, quote, maxPage, "default")
  }

  HIGHLIGHT_PDF_TAG.lastIndex = 0
  while ((m = HIGHLIGHT_PDF_TAG.exec(text)) !== null) {
    const page = Number.parseInt(m[1]!, 10)
    const quote = (m[2] ?? m[3] ?? m[4] ?? "").trim()
    if (!Number.isFinite(page)) continue
    pushHighlight(out, seen, page, quote, maxPage, "default")
  }

  return out
}

export function stripHighlightTags(text: string): string {
  return text.replace(ALL_HIGHLIGHT_TAGS, "")
}
