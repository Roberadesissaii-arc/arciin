/** AI-only navigation tag — preview scrolls when the assistant includes this. */
const GOTO_PAGE_TAG = /\[goto-page:(\d{1,4})\]/i

export function parseAssistantGotoPage(text: string, maxPage?: number): number | null {
  const m = text.match(GOTO_PAGE_TAG)
  if (!m) return null
  const n = Number.parseInt(m[1]!, 10)
  if (!Number.isFinite(n) || n < 1) return null
  if (maxPage && maxPage > 0 && n > maxPage) return maxPage
  return n
}

import { stripHighlightTags } from "@/lib/files/parse-pdf-highlight-request"

/** Remove navigation + highlight control tags before showing assistant text in the UI. */
export function stripGotoPageTags(text: string): string {
  return stripHighlightTags(
    text
      .replace(/\[goto-page:\d{1,4}\]/gi, "")
      .replace(/\n{3,}/g, "\n\n"),
  )
}
