/** Labels parsed from a single PDF page's extracted text. */
export type PdfPageLabel = {
  pdfPage: number
  printedPage?: number
  chapter?: number
  chapterTitle?: string
  /** True when "CHAPTER N" appears near the top (likely chapter start). */
  isChapterStart?: boolean
}

const FOOTER_PATTERN =
  /(\d{1,4})\s*\|\s*Chapter\s+(\d+)(?:\s*[:\-–]\s*([^\n|]+))?/i

const CHAPTER_HEAD_PATTERN = /\bCHAPTER\s+(\d+)\b/i

/** Footer like "43 | Chapter 4: Web Forms" or "14 | Chapter 2: Basic Application Structure". */
export function extractFooterLabels(text: string): {
  printedPage?: number
  chapter?: number
  chapterTitle?: string
} {
  const m = text.match(FOOTER_PATTERN)
  if (!m) return {}
  const printedPage = Number.parseInt(m[1]!, 10)
  const chapter = Number.parseInt(m[2]!, 10)
  const chapterTitle = m[3]?.trim()
  return {
    printedPage: Number.isFinite(printedPage) ? printedPage : undefined,
    chapter: Number.isFinite(chapter) ? chapter : undefined,
    chapterTitle: chapterTitle || undefined,
  }
}

/** "CHAPTER 4" style heading, usually at the start of a chapter. */
export function detectChapterStart(text: string): {
  chapter?: number
  isChapterStart: boolean
} {
  const head = text.slice(0, 900)
  const m = head.match(CHAPTER_HEAD_PATTERN)
  if (!m) return { isChapterStart: false }
  const chapter = Number.parseInt(m[1]!, 10)
  return {
    chapter: Number.isFinite(chapter) ? chapter : undefined,
    isChapterStart: true,
  }
}

export function extractPageLabels(
  pdfPage: number,
  pageText: string,
): PdfPageLabel {
  const footer = extractFooterLabels(pageText)
  const start = detectChapterStart(pageText)
  return {
    pdfPage,
    printedPage: footer.printedPage,
    chapter: footer.chapter ?? start.chapter,
    chapterTitle: footer.chapterTitle,
    isChapterStart: start.isChapterStart,
  }
}

/** Merge scan results into a compact chapter / printed-page index (one row per chapter start or labeled page). */
export function buildPdfPageIndex(labels: PdfPageLabel[]): PdfPageLabel[] {
  const index: PdfPageLabel[] = []
  let lastChapter: number | undefined

  for (const row of labels) {
    const chapterChanged =
      row.isChapterStart &&
      row.chapter !== undefined &&
      row.chapter !== lastChapter
    const hasPrinted = row.printedPage !== undefined
    const hasFooterChapter = row.chapter !== undefined && hasPrinted

    if (chapterChanged || hasFooterChapter) {
      index.push({
        pdfPage: row.pdfPage,
        printedPage: row.printedPage,
        chapter: row.chapter,
        chapterTitle: row.chapterTitle,
        isChapterStart: row.isChapterStart,
      })
      if (row.chapter !== undefined) lastChapter = row.chapter
    }
  }

  return index
}

/**
 * Best PDF page to show when the user asks to "open Chapter N".
 * Prefers the first footer-labeled body page (printed number on screen), not the
 * title-only spread before the printed page number appears.
 */
export function findPdfPageForChapter(
  index: PdfPageLabel[],
  chapterNumber: number,
): number | undefined {
  const bodyPages = index
    .filter((e) => e.chapter === chapterNumber && e.printedPage !== undefined)
    .sort((a, b) => (a.printedPage ?? 0) - (b.printedPage ?? 0))
  if (bodyPages.length > 0) return bodyPages[0]!.pdfPage

  const starts = index.filter(
    (e) => e.isChapterStart && e.chapter === chapterNumber,
  )
  if (starts.length > 0) return starts[0]!.pdfPage

  const byChapter = index.filter((e) => e.chapter === chapterNumber)
  if (byChapter.length > 0) return byChapter[0]!.pdfPage

  return undefined
}

export function findPdfPageForPrintedPage(
  index: PdfPageLabel[],
  printedPage: number,
): number | undefined {
  const exact = index.find((e) => e.printedPage === printedPage)
  return exact?.pdfPage
}

export function formatPdfPageMarker(
  pdfPage: number,
  label: Pick<PdfPageLabel, "printedPage" | "chapter" | "chapterTitle">,
): string {
  const parts = [`PDF page ${pdfPage}`]
  if (label.printedPage !== undefined) {
    parts.push(`printed page ${label.printedPage}`)
  }
  if (label.chapter !== undefined) {
    const title = label.chapterTitle ? `: ${label.chapterTitle}` : ""
    parts.push(`Chapter ${label.chapter}${title}`)
  }
  return `--- ${parts.join(" · ")} ---`
}

/** Compact index block for the model (navigation must use PDF page numbers). */
/** One-line hints so the model uses the exact PDF page for common chapter opens. */
export function formatChapterNavigationHints(index: PdfPageLabel[]): string {
  const chapters = [
    ...new Set(
      index.map((e) => e.chapter).filter((c): c is number => typeof c === "number"),
    ),
  ].sort((a, b) => a - b)

  if (chapters.length === 0) return ""

  const lines = chapters.map((ch) => {
    const pdf = findPdfPageForChapter(index, ch)
    if (!pdf) return null
    const row =
      index.find((e) => e.pdfPage === pdf && e.chapter === ch) ??
      index.find((e) => e.pdfPage === pdf)
    const printed =
      row?.printedPage !== undefined ? ` (printed page ${row.printedPage} on screen)` : ""
    return `- Open Chapter ${ch} → **[goto-page:${pdf}]**${printed}`
  })

  const filtered = lines.filter((l): l is string => Boolean(l))
  if (filtered.length === 0) return ""

  return [
    "## Chapter open targets (use these exact [goto-page:N] tags)",
    "When the user asks to open a chapter, use the matching line below — not the chapter number as a page index.",
    "",
    ...filtered,
  ].join("\n")
}

export function formatPdfPageIndexForPrompt(index: PdfPageLabel[]): string {
  if (index.length === 0) {
    return ""
  }

  const lines = index.map((e) => {
    const bits = [`PDF page ${e.pdfPage}`]
    if (e.printedPage !== undefined) bits.push(`printed ${e.printedPage}`)
    if (e.chapter !== undefined) {
      const title = e.chapterTitle ? ` — ${e.chapterTitle}` : ""
      bits.push(`Chapter ${e.chapter}${title}`)
    }
    if (e.isChapterStart) bits.push("(chapter start)")
    return `- ${bits.join(" · ")}`
  })

  return [
    "## PDF page index (navigation)",
    "The preview viewer counts **PDF pages** (includes cover, TOC, blanks). Numbers printed on the book page are **printed pages** — they are often different.",
    "**[goto-page:N]** and **[highlight:N:…]** must use the **PDF page** from this index, never the printed page number alone.",
    'When the user says "Chapter 4" or "open chapter fourteen", use **Chapter open targets** if present, else the Chapter 4 row below — never use printed page 4 or PDF page 4 as the page index.',
    'When the user says "page 43", prefer the row with **printed 43** and navigate to its **PDF page**.',
    "",
    ...lines,
  ].join("\n")
}
