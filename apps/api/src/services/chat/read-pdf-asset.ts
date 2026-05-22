import type { PrismaClient } from "@prisma/client"
import {
  buildPdfPageIndex,
  extractPageLabels,
  formatPdfPageIndexForPrompt,
  formatPdfPageMarker,
  type PdfPageLabel,
} from "@arciin/shared"
import { readFile, stat } from "node:fs/promises"

const MAX_FILE_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_CHARS = 14_000
const DEFAULT_MAX_PAGES = 60
const MAX_INDEX_PAGES = 500

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
        message: "PDF is too large to extract in chat; try a smaller file or ask about a section.",
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

    const indexPageNumbers = Array.from(
      { length: Math.min(totalPages, MAX_INDEX_PAGES) },
      (_, i) => i + 1,
    )
    const allPageNumbers = [
      ...new Set([...indexPageNumbers, ...contentPageNumbers]),
    ].sort((a, b) => a - b)

    const texts = await loadPdfTexts(doc, allPageNumbers)
    const pageIndex = buildIndexFromTexts(
      new Map(indexPageNumbers.map((n) => [n, texts.get(n) ?? ""])),
    )
    const indexPrompt = formatPdfPageIndexForPrompt(pageIndex)

    const parts: string[] = []
    for (const i of contentPageNumbers) {
      const text = texts.get(i) ?? ""
      const labels = extractPageLabels(i, text)
      const marker = formatPdfPageMarker(i, labels)
      parts.push(`${marker}\n${text || "(no extractable text on this page)"}`)
    }

    await doc.destroy()

    const pagesToRead = contentPageNumbers.length
    let content = parts.join("\n\n")
    const truncated =
      content.length > maxChars ||
      (!focusPage && totalPages > pagesToRead) ||
      (focusPage !== undefined && totalPages > 1)
    if (content.length > maxChars) {
      content = content.slice(0, maxChars)
    }

    const viewerNote =
      "Viewer status bar shows PDF page X / total (not printed page). Use PDF page in [goto-page:N]."

    return {
      asset_id: asset.id,
      filename: asset.originalFilename,
      library: asset.library.slug,
      num_pages: totalPages,
      pages_extracted: pagesToRead,
      truncated,
      page_index: pageIndex,
      navigation_note: viewerNote,
      content: indexPrompt ? `${indexPrompt}\n\n${viewerNote}\n\n${content}` : `${viewerNote}\n\n${content}`,
    }
  } catch {
    return { error: "read_failed", message: "Could not extract text from this PDF." }
  }
}
