import type { PrismaClient } from "@prisma/client"
import { readFile, stat } from "node:fs/promises"

const MAX_FILE_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_CHARS = 14_000
const DEFAULT_MAX_PAGES = 60

function isPdfAsset(filename: string, mimeType?: string | null): boolean {
  if (/\.pdf$/i.test(filename)) return true
  return (mimeType ?? "").toLowerCase() === "application/pdf"
}

export async function readPdfAssetContent(
  prisma: PrismaClient,
  input: { assetId: string; maxChars?: number; maxPages?: number },
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
    const pagesToRead = Math.min(totalPages, maxPages)
    const parts: string[] = []

    for (let i = 1; i <= pagesToRead; i++) {
      const page = await doc.getPage(i)
      const textContent = await page.getTextContent()
      const text = textContent.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
      parts.push(`--- Page ${i} ---\n${text || "(no extractable text on this page)"}`)
      page.cleanup()
    }

    await doc.destroy()

    let content = parts.join("\n\n")
    const truncated = content.length > maxChars || totalPages > pagesToRead
    if (content.length > maxChars) {
      content = content.slice(0, maxChars)
    }

    return {
      asset_id: asset.id,
      filename: asset.originalFilename,
      library: asset.library.slug,
      num_pages: totalPages,
      pages_extracted: pagesToRead,
      truncated,
      content,
    }
  } catch {
    return { error: "read_failed", message: "Could not extract text from this PDF." }
  }
}
