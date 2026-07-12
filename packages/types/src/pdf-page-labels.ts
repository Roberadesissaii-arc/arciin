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

/** Label row for a PDF page (when that page appears in the navigation index). */
export function findLabelForPdfPage(
  index: PdfPageLabel[],
  pdfPage: number,
): PdfPageLabel | undefined {
  return index.find((e) => e.pdfPage === pdfPage)
}

/** Title-case phrases likely to be section headings (for highlight hints). */
export function extractLikelyHeadings(pageText: string, max = 14): string[] {
  if (!pageText.trim()) return []
  const found: string[] = []
  const re = /\b[A-Z][A-Za-z0-9]*(?:\s+(?:[A-Z][A-Za-z0-9]*|&|of|the|for|and|in|to|a|an)){0,8}\b/g
  let m: RegExpExecArray | null
  while ((m = re.exec(pageText)) !== null) {
    const phrase = m[0]!.replace(/\s+/g, " ").trim()
    const words = phrase.split(/\s+/).filter(Boolean)
    if (words.length < 2 || words.length > 10) continue
    if (phrase.length < 6 || phrase.length > 72) continue
    if (/^(The|This|That|These|Those|In|On|At|For|With|When|If|As|But|And|Or)\s/i.test(phrase)) {
      continue
    }
    if (!found.some((f) => f.toLowerCase() === phrase.toLowerCase())) {
      found.push(phrase)
    }
    if (found.length >= max) break
  }
  return found
}

/** Human-readable block injected when the user has a PDF page open in preview. */
export function formatCurrentViewForPrompt(
  pdfPage: number,
  numPages: number,
  label?: Pick<PdfPageLabel, "printedPage" | "chapter" | "chapterTitle">,
  pageText?: string,
): string {
  const lines = [
    "## Current view (what the user sees right now)",
    `- **PDF page ${pdfPage}** of ${numPages} — preview status bar counts from the first page of the file (cover, TOC, blanks included).`,
  ]
  if (label?.printedPage !== undefined) {
    lines.push(
      `- **Printed/book page ${label.printedPage}** — the number printed on the book page itself (often different from the PDF page).`,
    )
  }
  if (label?.chapter !== undefined) {
    const title = label.chapterTitle ? `: ${label.chapterTitle}` : ""
    lines.push(`- **Chapter ${label.chapter}${title}** on this spread.`)
  }
  const headings = pageText ? extractLikelyHeadings(pageText) : []
  if (headings.length > 0) {
    lines.push(
      "",
      "Likely section headings on this page (use **exact** text for highlights):",
      ...headings.map((h) => `- "${h}"`),
    )
  }
  lines.push(
    "",
    'When the user asks "what page am I on" or "what page is this", answer with **both** numbers when known.',
    "Example: You are on **PDF page 15** in the viewer. The book shows **printed page 3** on this page.",
    "",
    'To highlight a **section title** they name (e.g. "About This Book"), use **[highlight-heading:"Exact Heading"]**.',
    'To highlight other text on this page, use **[highlight-current:"exact phrase"]** copied from the page extract below.',
    "**[highlight:N:…]** must use the **PDF page N** from the index, never the printed page alone.",
  )
  return lines.join("\n")
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
