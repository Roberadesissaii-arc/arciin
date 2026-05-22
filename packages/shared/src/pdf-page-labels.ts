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

export function findPdfPageForChapter(
  index: PdfPageLabel[],
  chapterNumber: number,
): number | undefined {
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
    'When the user says "Chapter 4" or "open chapter fourteen", find **Chapter 4** below — do not use printed page 4 or PDF page 4 unless that row says so.',
    'When the user says "page 43", prefer the row with **printed 43** and navigate to its **PDF page**.',
    "",
    ...lines,
  ].join("\n")
}
