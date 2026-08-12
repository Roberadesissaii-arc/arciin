/**
 * Work out which page to scroll to when the model answered in prose.
 *
 * Same shape as the highlight fallback: `[goto-page:N]` is the fast path, and
 * this is what happens when the model writes "Sure — that's on page 12" instead
 * of emitting the tag. Without it the answer names a page the viewer never
 * moves to, which reads as the feature being broken.
 */

import type { PdfPageLabel } from "@arciin/shared"
import { findPdfPageForPrintedPage } from "@arciin/shared"

/**
 * Verbs that mean "move the document". A destination is enough on their own —
 * "take me to where the Calvin Cycle starts" names no number, and the page the
 * answer identifies is the one to scroll to.
 */
const MOVEMENT_VERB =
  /\b(?:go\s+to|goto|take\s+me\s+to|jump\s+to|turn\s+to|navigate\s+to|scroll\s+to|skip\s+to|open)\b/i

/**
 * Verbs that are usually a highlight request, not a navigation one. "Show me
 * where it says RuBisCO" means mark it on this page; these only move the
 * document when the user names a page number outright.
 */
const SOFT_VERB = /\b(?:show\s+me|where\s+is|find)\b/i

/** "page 12", "p. 12", "pg 12" — the number the user or the model named. */
const PAGE_NUMBER = /\bp(?:age|g|\.)?\s*(\d{1,4})\b/i

export type InferPageInput = {
  userText: string
  assistantText: string
  maxPage?: number
  /** Printed-to-PDF map, when the file has one. */
  pageIndex?: PdfPageLabel[]
}

function clamp(page: number, maxPage?: number): number | null {
  if (!Number.isFinite(page) || page < 1) return null
  if (maxPage && maxPage > 0 && page > maxPage) return null
  return Math.floor(page)
}

/** True when the user asked to be moved somewhere in the document. */
export function wantsPageNavigation(userText: string): boolean {
  const t = userText || ""
  if (MOVEMENT_VERB.test(t)) return true
  return SOFT_VERB.test(t) && PAGE_NUMBER.test(t)
}

/**
 * The page to scroll to, or null to stay put.
 *
 * The user's own number wins over the model's: if they asked for page 12 and the
 * answer discusses page 3, they still asked for 12. The model's number is only
 * used when the user named a target without a number ("take me to where the
 * Calvin cycle starts") and the answer supplies one.
 */
export function inferPdfGotoPage(input: InferPageInput): number | null {
  const { userText, assistantText, maxPage, pageIndex } = input
  if (!wantsPageNavigation(userText)) return null

  const fromUser = userText.match(PAGE_NUMBER)
  if (fromUser?.[1]) {
    const asked = Number.parseInt(fromUser[1], 10)
    // A page number the user gives is the printed one when the file knows its
    // own numbering — "page 12" means the 12 printed on the paper, not the
    // twelfth file page, and on a book with front matter those differ.
    if (pageIndex?.length) {
      const mapped = findPdfPageForPrintedPage(pageIndex, asked)
      if (mapped) return clamp(mapped, maxPage)
    }
    return clamp(asked, maxPage)
  }

  const fromAnswer = (assistantText || "").match(PAGE_NUMBER)
  if (fromAnswer?.[1]) {
    const named = Number.parseInt(fromAnswer[1], 10)
    if (pageIndex?.length) {
      const mapped = findPdfPageForPrintedPage(pageIndex, named)
      if (mapped) return clamp(mapped, maxPage)
    }
    return clamp(named, maxPage)
  }

  return null
}
