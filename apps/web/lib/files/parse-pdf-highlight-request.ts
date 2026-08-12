import type { PdfPageLabel } from "@arciin/shared"
import { findPdfPageForPrintedPage } from "@arciin/shared"

import {
  ANNOTATION_TAG_NAMES,
  normalizeAnnotationStyle,
  type PdfAnnotationStyle,
} from "@/lib/files/pdf-annotation-style"
import type { PdfHighlightTarget } from "@/lib/files/pdf-highlight-types"

/**
 * One tag family for every mark.
 *
 * `[<style>-current:"…"]` · `[<style>-heading:"…"]` · `[<style>-printed:N:"…"]`
 * · `[<style>:N:"…"]`, where <style> is highlight, underline, circle, box or
 * strike (plus the aliases a model reaches for — "mark", "pen", "outline").
 * Written out per style this would be twenty regexes that drift apart; the
 * style is a capture group instead, so adding a mark is one entry in the shared
 * vocabulary and nothing else.
 */
const QUOTED = `(?:"([^"]*)"|'([^']*)'|([^\\]\\n]+))`

const CURRENT_TAG = new RegExp(`\\[(${ANNOTATION_TAG_NAMES})-current:${QUOTED}\\]`, "gi")
const HEADING_TAG = new RegExp(`\\[(${ANNOTATION_TAG_NAMES})-heading:${QUOTED}\\]`, "gi")
const PRINTED_TAG = new RegExp(
  `\\[(${ANNOTATION_TAG_NAMES})-printed:(\\d{1,4}):${QUOTED}\\]`,
  "gi",
)
const PDF_PAGE_TAG = new RegExp(`\\[(${ANNOTATION_TAG_NAMES}):(\\d{1,4}):${QUOTED}\\]`, "gi")

const ALL_HIGHLIGHT_TAGS = new RegExp(
  [CURRENT_TAG.source, HEADING_TAG.source, PRINTED_TAG.source, PDF_PAGE_TAG.source].join("|"),
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
  style: PdfAnnotationStyle = "highlight",
) {
  const trimmed = quote.trim()
  if (!trimmed) return
  const clamped = clampPage(page, maxPage)
  // Style is part of the identity: asked to highlight *and* circle the same
  // heading, the user wants both marks, not the first one twice.
  const key = `${style}:${kind ?? "default"}:${clamped}:${trimmed.toLowerCase()}`
  if (seen.has(key)) return
  seen.add(key)
  out.push({ page: clamped, quote: trimmed, kind, style })
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

  // Group 1 is the style; the quote is whichever of the next three matched.
  HEADING_TAG.lastIndex = 0
  while ((m = HEADING_TAG.exec(text)) !== null) {
    const style = normalizeAnnotationStyle(m[1])
    const quote = (m[2] ?? m[3] ?? m[4] ?? "").trim()
    if (currentPdfPage && currentPdfPage > 0) {
      pushHighlight(out, seen, currentPdfPage, quote, maxPage, "heading", style)
    }
  }

  CURRENT_TAG.lastIndex = 0
  while ((m = CURRENT_TAG.exec(text)) !== null) {
    const style = normalizeAnnotationStyle(m[1])
    const quote = (m[2] ?? m[3] ?? m[4] ?? "").trim()
    if (currentPdfPage && currentPdfPage > 0) {
      pushHighlight(out, seen, currentPdfPage, quote, maxPage, "default", style)
    }
  }

  PRINTED_TAG.lastIndex = 0
  while ((m = PRINTED_TAG.exec(text)) !== null) {
    const style = normalizeAnnotationStyle(m[1])
    const printed = Number.parseInt(m[2]!, 10)
    const quote = (m[3] ?? m[4] ?? m[5] ?? "").trim()
    if (!Number.isFinite(printed) || !pageIndex?.length) continue
    const pdf = findPdfPageForPrintedPage(pageIndex, printed)
    if (pdf) pushHighlight(out, seen, pdf, quote, maxPage, "default", style)
  }

  PDF_PAGE_TAG.lastIndex = 0
  while ((m = PDF_PAGE_TAG.exec(text)) !== null) {
    const style = normalizeAnnotationStyle(m[1])
    const page = Number.parseInt(m[2]!, 10)
    const quote = (m[3] ?? m[4] ?? m[5] ?? "").trim()
    if (!Number.isFinite(page)) continue
    pushHighlight(out, seen, page, quote, maxPage, "default", style)
  }

  return out
}

export function stripHighlightTags(text: string): string {
  return text.replace(ALL_HIGHLIGHT_TAGS, "")
}
