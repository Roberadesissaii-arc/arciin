import type { PrismaClient } from "@prisma/client"
import {
  buildPdfPageIndex,
  extractPageLabels,
  formatChapterNavigationHints,
  formatCurrentViewForPrompt,
  formatPdfPageIndexForPrompt,
  formatPdfPageMarker,
  type PdfPageLabel,
} from "@arciin/shared"
import { readFile, stat } from "node:fs/promises"

const MAX_FILE_BYTES = 150 * 1024 * 1024
const DEFAULT_MAX_CHARS = 14_000
const DEFAULT_MAX_PAGES = 60
const MAX_INDEX_PAGES = 500

function indexPageNumbersFor(totalPages: number, fileBytes: number): number[] {
  if (totalPages <= 120) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  if (fileBytes > 24 * 1024 * 1024 || totalPages > 250) {
    const set = new Set<number>()
    for (let i = 1; i <= Math.min(80, totalPages); i++) set.add(i)
    for (let i = 81; i <= totalPages - 20; i += 12) set.add(i)
    for (let i = Math.max(1, totalPages - 19); i <= totalPages; i++) set.add(i)
    return [...set].sort((a, b) => a - b)
  }
  return Array.from({ length: Math.min(totalPages, MAX_INDEX_PAGES) }, (_, i) => i + 1)
}

type PdfTextPage = {
  getTextContent: () => Promise<{
    items: Array<{ str?: string } | Record<string, unknown>>
  }>
  cleanup: () => void
}

function isPdfAsset(filename: string, mimeType?: string | null): boolean {
  if (/\.pdf$/i.test(filename)) return true
  return (mimeType ?? "").toLowerCase() === "application/pdf"
}

async function extractPageText(page: PdfTextPage): Promise<string> {
  const textContent = await page.getTextContent()
  return textContent.items
    .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

async function loadPdfTexts(
  doc: { numPages: number; getPage: (n: number) => Promise<PdfTextPage> },
  pageNumbers: number[],
): Promise<Map<number, string>> {
  const texts = new Map<number, string>()
  for (const i of pageNumbers) {
    if (texts.has(i)) continue
    const page = await doc.getPage(i)
    texts.set(i, await extractPageText(page))
    page.cleanup()
  }
  return texts
}

function buildIndexFromTexts(texts: Map<number, string>): PdfPageLabel[] {
  const perPage: PdfPageLabel[] = []
  const sorted = [...texts.keys()].sort((a, b) => a - b)
  for (const pdfPage of sorted) {
    perPage.push(extractPageLabels(pdfPage, texts.get(pdfPage) ?? ""))
  }
  return buildPdfPageIndex(perPage)
}

export async function readPdfAssetContent(
  prisma: PrismaClient,
  input: { assetId: string; maxChars?: number; maxPages?: number; page?: number },
): Promise<Record<string, unknown>> {
  const assetId = input.assetId.trim()
  if (!assetId) {
    return { error: "validation", message: "asset_id is required." }
  }

  const maxChars = Math.min(32_000, Math.max(500, Number(input.maxChars) || DEFAULT_MAX_CHARS))
  const maxPages = Math.min(120, Math.max(1, Number(input.maxPages) || DEFAULT_MAX_PAGES))

  const asset = await prisma.asset.findFirst({
    where: { id: assetId, deletedAt: null },
    include: { storageObject: true, library: { select: { slug: true, name: true } } },
  })

  if (!asset) {
    return { error: "not_found", message: "Asset not found." }
  }

  if (!isPdfAsset(asset.originalFilename, asset.mimeType)) {
    return {
      error: "not_pdf",
      message: "This asset is not a PDF.",
      filename: asset.originalFilename,
    }
  }

  const path = asset.storageObject?.physicalPath
  if (!path) {
    return { error: "no_storage", message: "File content is not on disk." }
  }

  try {
    const fileStat = await stat(path)
    if (fileStat.size > MAX_FILE_BYTES) {
      return {
        error: "too_large",
        message:
          "PDF exceeds the server read limit; page text may be unavailable. Try asking about the page you have open.",
        sizeBytes: Number(fileStat.size),
      }
    }

    const data = await readFile(path)
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise

    const totalPages = doc.numPages
    const focusPage =
      input.page && input.page > 0 ? Math.min(input.page, totalPages) : undefined
    const contentPageNumbers = focusPage
      ? [focusPage, focusPage - 1, focusPage + 1].filter((p) => p >= 1 && p <= totalPages)
      : Array.from({ length: Math.min(totalPages, maxPages) }, (_, i) => i + 1)

    const indexPageNumbers = indexPageNumbersFor(totalPages, fileStat.size)
    const allPageNumbers = [
      ...new Set([...indexPageNumbers, ...contentPageNumbers]),
    ].sort((a, b) => a - b)

    const texts = await loadPdfTexts(doc, allPageNumbers)
    const pageIndex = buildIndexFromTexts(
      new Map(indexPageNumbers.map((n) => [n, texts.get(n) ?? ""])),
    )
    const chapterHints = formatChapterNavigationHints(pageIndex)
    const indexPrompt = [chapterHints, formatPdfPageIndexForPrompt(pageIndex)]
      .filter(Boolean)
      .join("\n\n")

    const focusPageText = focusPage !== undefined ? texts.get(focusPage) ?? "" : ""
    const currentViewBlock =
      focusPage !== undefined
        ? formatCurrentViewForPrompt(
            focusPage,
            totalPages,
            extractPageLabels(focusPage, focusPageText),
            focusPageText,
          )
        : ""

    const parts: string[] = []
    for (const i of contentPageNumbers) {
      const text = texts.get(i) ?? ""
      const labels = extractPageLabels(i, text)
      const marker = formatPdfPageMarker(i, labels)
      parts.push(`${marker}\n${text || "(no extractable text on this page)"}`)
    }

    await doc.destroy()

    const pagesToRead = contentPageNumbers.length
    let orderedParts = parts
    if (focusPage !== undefined) {
      const focusIdx = contentPageNumbers.indexOf(focusPage)
      if (focusIdx > 0) {
        orderedParts = [parts[focusIdx]!, ...parts.filter((_, i) => i !== focusIdx)]
      }
    }
    let content = orderedParts.join("\n\n")
    const truncatedByLength = content.length > maxChars
    const truncatedByScope = !focusPage && totalPages > pagesToRead
    const truncated = truncatedByLength || truncatedByScope
    if (truncatedByLength) {
      content = content.slice(0, maxChars)
    }

    const viewerNote =
      "Viewer status bar shows PDF page X / total (not printed page). Use PDF page in [goto-page:N] and [highlight:N:…]. Use [highlight-current:…] or [highlight-heading:…] for the page in Current view."

    const truncatedNote = truncated
      ? focusPage
        ? "\n(Chapter index may be partial for large books — current page text is included above.)"
        : "\n(Extract is partial — say so if the answer may be on a missing page.)"
      : ""

    const promptSections = [indexPrompt, currentViewBlock, viewerNote, content].filter(Boolean)

    return {
      asset_id: asset.id,
      filename: asset.originalFilename,
      library: asset.library.slug,
      num_pages: totalPages,
      pages_extracted: pagesToRead,
      truncated,
      page_index: pageIndex,
      navigation_note: viewerNote,
      content: promptSections.join("\n\n") + truncatedNote,
    }
  } catch {
    return { error: "read_failed", message: "Could not extract text from this PDF." }
  }
}

/** Lightweight chapter / printed-page index for client-side goto resolution. */
export async function getPdfNavigationIndex(
  prisma: PrismaClient,
  assetId: string,
): Promise<
  | { error: string; message: string }
  | { asset_id: string; num_pages: number; page_index: PdfPageLabel[] }
> {
  const result = await readPdfAssetContent(prisma, {
    assetId,
    maxPages: 1,
    maxChars: 500,
  })
  if (typeof result.page_index !== "object" || !Array.isArray(result.page_index)) {
    const msg =
      typeof result.message === "string" ? result.message : "Could not build PDF page index."
    return { error: "read_failed", message: msg }
  }
  return {
    asset_id: String(result.asset_id ?? assetId),
    num_pages: Number(result.num_pages) || 0,
    page_index: result.page_index as PdfPageLabel[],
  }
}
