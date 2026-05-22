import type { PdfHighlightTarget } from "@/lib/files/pdf-highlight-types"

/** AI highlight tag — viewer scrolls to page and marks matching text. */
const HIGHLIGHT_TAG =
  /\[highlight:(\d{1,4}):(?:"([^"]*)"|'([^']*)'|([^\]\n]+))\]/gi

export function parseAssistantHighlights(
  text: string,
  maxPage?: number,
): PdfHighlightTarget[] {
  const out: PdfHighlightTarget[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  HIGHLIGHT_TAG.lastIndex = 0
  while ((m = HIGHLIGHT_TAG.exec(text)) !== null) {
    const page = Number.parseInt(m[1]!, 10)
    const quote = (m[2] ?? m[3] ?? m[4] ?? "").trim()
    if (!Number.isFinite(page) || page < 1 || !quote) continue
    const clamped =
      maxPage && maxPage > 0 ? Math.min(page, maxPage) : page
    const key = `${clamped}:${quote.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ page: clamped, quote })
  }
  return out
}

export function stripHighlightTags(text: string): string {
  return text.replace(HIGHLIGHT_TAG, "")
}
