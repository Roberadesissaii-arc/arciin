/**
 * Lightweight PDF InfoDict + page-count read.
 *
 * Used by the worker on upload and by the API for lazy backfill on older files.
 * Does not extract full page text — that stays in the chat/summarize path.
 */

export type PdfFileMetadata = {
  pageCount: number | null
  author: string | null
  title: string | null
  subject: string | null
  creator: string | null
  producer: string | null
  keywords: string | null
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 500) : null
}

/**
 * Read page count and InfoDict fields from PDF bytes.
 *
 * Returns nulls rather than throwing when the file is not a readable PDF so
 * upload processing can continue.
 */
export async function extractPdfMetadataFromBytes(data: Uint8Array): Promise<PdfFileMetadata> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
    const pageCount = Number.isFinite(doc.numPages) && doc.numPages > 0 ? doc.numPages : null

    let author: string | null = null
    let title: string | null = null
    let subject: string | null = null
    let creator: string | null = null
    let producer: string | null = null
    let keywords: string | null = null

    try {
      const meta = await doc.getMetadata()
      const info = (meta?.info ?? {}) as Record<string, unknown>
      author = asTrimmedString(info.Author)
      title = asTrimmedString(info.Title)
      subject = asTrimmedString(info.Subject)
      creator = asTrimmedString(info.Creator)
      producer = asTrimmedString(info.Producer)
      keywords = asTrimmedString(info.Keywords)
    } catch {
      /* InfoDict is optional */
    }

    // pdf.js 6 removed PDFDocumentProxy.destroy(); the loading task owns teardown.
    await doc.loadingTask.destroy()

    return { pageCount, author, title, subject, creator, producer, keywords }
  } catch {
    return {
      pageCount: null,
      author: null,
      title: null,
      subject: null,
      creator: null,
      producer: null,
      keywords: null,
    }
  }
}

export function isPdfFilenameOrMime(filename: string, mimeType?: string | null): boolean {
  if (/\.pdf$/i.test(filename)) return true
  return (mimeType ?? "").toLowerCase() === "application/pdf"
}
