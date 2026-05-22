import type { PDFDocumentProxy } from "pdfjs-dist"

import { loadPdfJs } from "@/lib/files/pdfjs-client"
import type { PdfHighlightRect } from "@/lib/files/pdf-highlight-types"

type PdfTextItem = {
  str: string
  transform: number[]
  width: number
  height?: number
}

function buildSearchableText(items: PdfTextItem[]): { text: string; spans: { start: number; end: number; index: number }[] } {
  let text = ""
  const spans: { start: number; end: number; index: number }[] = []

  for (let i = 0; i < items.length; i++) {
    const str = items[i]!.str
    if (!str) continue
    const start = text.length
    text += str
    spans.push({ start, end: text.length, index: i })
    if (i < items.length - 1 && !/\s$/.test(str)) text += " "
  }

  return { text, spans }
}

function findMatchRange(text: string, query: string): { start: number; end: number } | null {
  const q = query.trim()
  if (!q) return null

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const flexible = escaped.replace(/\s+/g, "\\s+")
  const re = new RegExp(flexible, "i")
  const m = text.match(re)
  if (m && m.index !== undefined) {
    return { start: m.index, end: m.index + m[0].length }
  }

  const words = q.split(/\s+/).filter(Boolean)
  for (let len = words.length; len >= 2; len--) {
    const sub = words.slice(0, len).join(" ")
    const subEsc = sub.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
    const subRe = new RegExp(subEsc, "i")
    const sm = text.match(subRe)
    if (sm && sm.index !== undefined) {
      return { start: sm.index, end: sm.index + sm[0].length }
    }
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
  const left = t[4] ?? 0
  const top = (t[5] ?? 0) - fontHeight
  const width = (item.width || fontHeight * 2) * Math.abs(t[0] || 1)

  return {
    left,
    top,
    width,
    height: fontHeight,
  }
}

function mergeRects(rects: PdfHighlightRect[]): PdfHighlightRect[] {
  if (rects.length === 0) return []
  let minL = Infinity
  let minT = Infinity
  let maxR = -Infinity
  let maxB = -Infinity
  for (const r of rects) {
    minL = Math.min(minL, r.left)
    minT = Math.min(minT, r.top)
    maxR = Math.max(maxR, r.left + r.width)
    maxB = Math.max(maxB, r.top + r.height)
  }
  const pad = 3
  return [
    {
      left: Math.max(0, minL - pad),
      top: Math.max(0, minT - pad),
      width: maxR - minL + pad * 2,
      height: maxB - minT + pad * 2,
    },
  ]
}

export async function findHighlightRectsOnPage(
  pdf: PDFDocumentProxy,
  pageNumber: number,
  query: string,
  displayWidth: number,
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
    const range = findMatchRange(text, rawQuery)
    if (!range) return []

    const hitIndices = new Set<number>()
    for (const span of spans) {
      if (span.end <= range.start || span.start >= range.end) continue
      hitIndices.add(span.index)
    }

    const rects: PdfHighlightRect[] = []
    const vt = viewport.transform
    for (const idx of hitIndices) {
      const item = items[idx]
      if (!item?.str.trim()) continue
      rects.push(itemToRect(item, pdfjs.Util, vt))
    }

    return mergeRects(rects)
  } finally {
    page.cleanup()
  }
}
