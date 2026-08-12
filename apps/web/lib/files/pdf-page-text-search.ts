import type { PDFDocumentProxy } from "pdfjs-dist"

import { loadPdfJs } from "@/lib/files/pdfjs-client"
import type { PdfHighlightRect } from "@/lib/files/pdf-highlight-types"

export type PdfTextItem = {
  str: string
  transform: number[]
  width: number
  height?: number
}

export type MatchMode = "default" | "heading"

/**
 * Subscripts and superscripts, flattened to plain digits.
 *
 * A PDF that reads "CO₂" on paper often stores the 2 as a separate positioned
 * glyph, and some extractors drop it entirely — this document's text layer holds
 * "6 CO + 6 HO". A model quoting the formula writes the subscripts, so the query
 * and the page can never match on a straight comparison. Both sides are
 * flattened here, and `buildFlexiblePattern` then makes the digits optional so a
 * query of "CO2" still finds a page that says "CO".
 */
export function flattenScriptDigits(value: string): string {
  return value
    .replace(/[\u2080-\u2089]/g, (c) => String(c.charCodeAt(0) - 0x2080))
    .replace(/[\u2070\u2074-\u2079]/g, (c) => String(c.charCodeAt(0) - 0x2070))
    .replace(/\u00b9/g, "1")
    .replace(/\u00b2/g, "2")
    .replace(/\u00b3/g, "3")
}

export function buildSearchableText(items: PdfTextItem[]): { text: string; spans: { start: number; end: number; index: number }[] } {
  let text = ""
  const spans: { start: number; end: number; index: number }[] = []

  for (let i = 0; i < items.length; i++) {
    const str = flattenScriptDigits(items[i]!.str)
    if (!str) continue
    const start = text.length
    text += str
    spans.push({ start, end: text.length, index: i })
    if (i < items.length - 1 && !/\s$/.test(str)) text += " "
  }

  return { text, spans }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function normalizeForMatch(value: string): string {
  return flattenScriptDigits(value).replace(/\s+/g, " ").trim().toLowerCase()
}

/**
 * Drop the digits welded to letters, for comparison only.
 *
 * The pattern already treats "CO2" and "CO" as the same token, but the score
 * that decides whether a match is worth keeping compared raw words and threw the
 * match away again: "h2o" does not contain "ho" as a substring. Both sides are
 * folded the same way here so scoring agrees with matching.
 */
function foldFormulaDigits(value: string): string {
  return value.replace(/([a-z])\d+/gi, "$1")
}

function buildFlexiblePattern(query: string): RegExp {
  const trimmed = flattenScriptDigits(query).trim()
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return /$^/

  const pattern = parts
    .map((part) => {
      const escaped = escapeRegex(part)
      // "3.2" in the query must also match "3 . 2" in the text layer, which is
      // how some extractors emit a numbered heading.
      const spaced = escaped.replace(/(\d)\\?\.(\d)/g, "$1\\s*\\.?\\s*$2")
      // Digits welded to letters are chemistry — CO2, H2O, G3P — and the text
      // layer may have lost them with the subscript they were set in. Make them
      // optional so "CO2" still matches a page that only kept "CO".
      return spaced.replace(/([A-Za-z])(\d+)(?![.\d])/g, "$1(?:$2)?")
    })
    .join("\\s+")

  // Global: the caller drives this with `exec` in a loop, and a non-global regex
  // ignores lastIndex and returns the same match forever — an unbounded loop
  // that grows the results array until the tab dies. It never fired only because
  // highlights never reached this code.
  return new RegExp(pattern, "gi")
}

function scoreMatch(matched: string, query: string, mode: MatchMode): number {
  const m = normalizeForMatch(matched)
  const q = normalizeForMatch(query)
  if (!m || !q) return -1
  if (m === q) return 1000
  if (m.includes(q)) return 800 + q.length - Math.abs(m.length - q.length)
  const qWords = foldFormulaDigits(q).split(/\s+/).filter(Boolean)
  const mWords = foldFormulaDigits(m).split(/\s+/).filter(Boolean)
  const allPresent = qWords.every((w) => mWords.some((mw) => mw.includes(w) || w.includes(mw)))
  if (!allPresent) return -1
  let score = 400 + qWords.length * 20
  score -= Math.abs(m.length - q.length)
  if (mode === "heading" && /^[A-Z]/.test(matched.trim())) score += 80
  return score
}

function findAllFlexibleMatches(text: string, query: string, mode: MatchMode): { start: number; end: number; score: number }[] {
  const results: { start: number; end: number; score: number }[] = []
  const q = query.trim()
  if (!q) return results

  const lowerText = flattenScriptDigits(text).toLowerCase()
  const lowerQ = flattenScriptDigits(q).toLowerCase()
  let idx = 0
  while (idx < lowerText.length) {
    const found = lowerText.indexOf(lowerQ, idx)
    if (found === -1) break
    const matched = text.slice(found, found + q.length)
    const score = scoreMatch(matched, q, mode)
    if (score >= 0) results.push({ start: found, end: found + q.length, score })
    idx = found + 1
  }

  const pattern = buildFlexiblePattern(q)
  pattern.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    const matched = m[0] ?? ""
    // A zero-length match leaves lastIndex where it was; step over it or the
    // loop stalls on the same position.
    if (!matched) {
      pattern.lastIndex += 1
      continue
    }
    const score = scoreMatch(matched, q, mode)
    if (score >= 0) {
      results.push({ start: m.index, end: m.index + matched.length, score })
    }
  }

  return results
}

function findHeadingMatch(text: string, query: string): { start: number; end: number } | null {
  const qWords = normalizeForMatch(query).split(/\s+/).filter(Boolean)
  if (qWords.length === 0) return null

  const candidates = findAllFlexibleMatches(text, query, "heading")
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score || a.start - b.start)
    const best = candidates[0]!
    return { start: best.start, end: best.end }
  }

  // Shortest span containing all query words in order.
  const pattern = qWords.map((w) => escapeRegex(w)).join("[\\s\\S]{0,40}?")
  const re = new RegExp(pattern, "i")
  const m = text.match(re)
  if (m && m.index !== undefined) {
    return { start: m.index, end: m.index + m[0].length }
  }

  return null
}

export function findMatchRange(text: string, query: string, mode: MatchMode = "default"): { start: number; end: number } | null {
  const q = query.trim()
  if (!q) return null

  if (mode === "heading") {
    const heading = findHeadingMatch(text, q)
    if (heading) return heading
  }

  const candidates = findAllFlexibleMatches(text, q, mode)
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score || a.start - b.start)
    const best = candidates[0]!
    return { start: best.start, end: best.end }
  }

  const compactQuery = q.replace(/\s*\.\s*/g, ".").replace(/\s+/g, " ").trim()
  if (compactQuery !== q) {
    const compactCandidates = findAllFlexibleMatches(text, compactQuery, mode)
    if (compactCandidates.length > 0) {
      compactCandidates.sort((a, b) => b.score - a.score || a.start - b.start)
      const best = compactCandidates[0]!
      return { start: best.start, end: best.end }
    }
  }

  if (mode === "default") {
    return findHeadingMatch(text, q)
  }

  return null
}

function itemToRect(
  item: PdfTextItem,
  Util: { transform: (m1: number[], m2: number[]) => number[] },
  viewportTransform: number[],
): PdfHighlightRect {
  const t = Util.transform(viewportTransform, item.transform)
  const fontHeight = Math.hypot(t[2] ?? 0, t[3] ?? 0) || item.height || 12
  const scaleX = Math.hypot(t[0] ?? 0, t[1] ?? 0) || Math.abs(t[0] || 1)
  const left = Math.max(0, t[4] ?? 0)
  const top = (t[5] ?? 0) - fontHeight

  const charCount = Math.max(item.str.trim().length, 1)
  const charWidth = fontHeight * 0.52
  const estimatedWidth = charCount * charWidth
  const reportedWidth = item.width > 0 ? item.width * scaleX : 0

  let width = reportedWidth > 0 ? reportedWidth : estimatedWidth
  if (reportedWidth > estimatedWidth * 1.65) {
    width = estimatedWidth
  }

  return {
    left,
    top,
    width: Math.max(4, width),
    height: fontHeight,
  }
}

function itemPartialRect(
  item: PdfTextItem,
  charStart: number,
  charEnd: number,
  Util: { transform: (m1: number[], m2: number[]) => number[] },
  viewportTransform: number[],
): PdfHighlightRect {
  const t = Util.transform(viewportTransform, item.transform)
  const fontHeight = Math.hypot(t[2] ?? 0, t[3] ?? 0) || item.height || 12
  const leftBase = Math.max(0, t[4] ?? 0)
  const top = (t[5] ?? 0) - fontHeight
  const charWidth = fontHeight * 0.52
  const len = Math.max(item.str.length, 1)
  const start = Math.max(0, Math.min(charStart, len))
  const end = Math.max(start + 1, Math.min(charEnd, len))

  return {
    left: leftBase + start * charWidth,
    top,
    width: Math.max(4, (end - start) * charWidth),
    height: fontHeight,
  }
}

function padRect(rect: PdfHighlightRect, pad = 2): PdfHighlightRect {
  return {
    left: Math.max(0, rect.left - pad),
    top: Math.max(0, rect.top - pad),
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  }
}

function mergeContiguousRects(rects: PdfHighlightRect[], gapTolerance = 12): PdfHighlightRect[] {
  if (rects.length === 0) return []

  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left)
  const groups: PdfHighlightRect[][] = [[sorted[0]!]]

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!
    const prev = groups[groups.length - 1]![groups[groups.length - 1]!.length - 1]!
    const sameLine = Math.abs(cur.top - prev.top) <= 5
    const gap = cur.left - (prev.left + prev.width)
    if (sameLine && gap <= gapTolerance) {
      groups[groups.length - 1]!.push(cur)
    } else {
      groups.push([cur])
    }
  }

  const pad = 2
  return groups.map((group) => {
    let minL = Infinity
    let minT = Infinity
    let maxR = -Infinity
    let maxB = -Infinity
    for (const r of group) {
      minL = Math.min(minL, r.left)
      minT = Math.min(minT, r.top)
      maxR = Math.max(maxR, r.left + r.width)
      maxB = Math.max(maxB, r.top + r.height)
    }
    return {
      left: Math.max(0, minL - pad),
      top: Math.max(0, minT - pad),
      width: maxR - minL + pad * 2,
      height: maxB - minT + pad * 2,
    }
  })
}

export async function findHighlightRectsOnPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  query: string,
  displayWidth: number,
  mode: MatchMode = "default",
): Promise<PdfHighlightRect[]> {
  const rawQuery = query.trim()
  if (!rawQuery || pageNumber < 1 || pageNumber > pdf.numPages || displayWidth < 1) {
    return []
  }

  const pdfjs = await loadPdfJs()
  const page = await pdf.getPage(pageNumber)
  try {
    const base = page.getViewport({ scale: 1 })
    const scale = displayWidth / base.width
    const viewport = page.getViewport({ scale })
    const textContent = await page.getTextContent()

    const items: PdfTextItem[] = []
    for (const item of textContent.items) {
      if (typeof item !== "object" || item === null || !("str" in item)) continue
      const str = (item as { str?: unknown }).str
      if (typeof str !== "string" || !str) continue
      const t = item as { transform?: number[]; width?: number; height?: number }
      if (!Array.isArray(t.transform)) continue
      items.push({
        str,
        transform: t.transform,
        width: typeof t.width === "number" ? t.width : 0,
        height: t.height,
      })
    }

    if (items.length === 0) return []

    const { text, spans } = buildSearchableText(items)
    const range = findMatchRange(text, rawQuery, mode)
    if (!range) return []

    const rects: PdfHighlightRect[] = []
    const vt = viewport.transform
    for (const span of spans) {
      if (span.end <= range.start || span.start >= range.end) continue
      const item = items[span.index]
      if (!item?.str.trim()) continue

      const overlapStart = Math.max(span.start, range.start)
      const overlapEnd = Math.min(span.end, range.end)
      const itemCharStart = overlapStart - span.start
      const itemCharEnd = overlapEnd - span.start
      const coversFullItem =
        itemCharStart <= 0 && itemCharEnd >= item.str.length - 0.01

      if (coversFullItem && item.str.length <= rawQuery.length + 4) {
        rects.push(padRect(itemToRect(item, pdfjs.Util, vt)))
      } else {
        rects.push(
          padRect(itemPartialRect(item, itemCharStart, itemCharEnd, pdfjs.Util, vt)),
        )
      }
    }

    return mergeContiguousRects(rects)
  } finally {
    page.cleanup()
  }
}
