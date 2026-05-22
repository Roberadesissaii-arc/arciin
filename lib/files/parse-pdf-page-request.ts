import type { PdfPageLabel } from "@arciin/shared"
import {
  findPdfPageForChapter,
  findPdfPageForPrintedPage,
} from "@arciin/shared"

/** AI-only navigation tags — preview scrolls when the assistant includes these. */
const GOTO_PAGE_TAG = /\[goto-page:(\d{1,4})\]/gi
const GOTO_PRINTED_TAG = /\[goto-printed:(\d{1,4})\]/gi
const GOTO_CHAPTER_TAG = /\[goto-chapter:(\d{1,3})\]/gi

function clampPage(n: number, maxPage?: number): number {
  if (!Number.isFinite(n) || n < 1) return 1
  if (maxPage && maxPage > 0 && n > maxPage) return maxPage
  return n
}

function lastMatchInt(text: string, pattern: RegExp): number | null {
  const re = new RegExp(pattern.source, pattern.flags)
  let last: number | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = Number.parseInt(m[1]!, 10)
    if (Number.isFinite(n)) last = n
  }
  return last
}

export function resolvePdfGotoPage(
  text: string,
  options?: { maxPage?: number; pageIndex?: PdfPageLabel[] },
): number | null {
  const { maxPage, pageIndex } = options ?? {}

  const chapter = lastMatchInt(text, GOTO_CHAPTER_TAG)
  if (chapter !== null && pageIndex?.length) {
    const pdf = findPdfPageForChapter(pageIndex, chapter)
    if (pdf) return clampPage(pdf, maxPage)
  }

  const printed = lastMatchInt(text, GOTO_PRINTED_TAG)
  if (printed !== null && pageIndex?.length) {
    const pdf = findPdfPageForPrintedPage(pageIndex, printed)
    if (pdf) return clampPage(pdf, maxPage)
  }

  const pdf = lastMatchInt(text, GOTO_PAGE_TAG)
  if (pdf !== null) return clampPage(pdf, maxPage)

  return null
}

/** @deprecated Use resolvePdfGotoPage — kept for callers without page index. */
export function parseAssistantGotoPage(text: string, maxPage?: number): number | null {
  return resolvePdfGotoPage(text, { maxPage })
}

import { stripHighlightTags } from "@/lib/files/parse-pdf-highlight-request"

const NAV_TAGS =
  /\[(?:goto-page|goto-printed|goto-chapter):\d{1,4}\]/gi

/** Remove navigation + highlight control tags before showing assistant text in the UI. */
export function stripGotoPageTags(text: string): string {
  return stripHighlightTags(
    text.replace(NAV_TAGS, "").replace(/\n{3,}/g, "\n\n"),
  )
}
