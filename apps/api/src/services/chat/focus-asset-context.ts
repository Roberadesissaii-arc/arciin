import type { PrismaClient } from "@prisma/client"

import { readPdfAssetContent } from "@/services/chat/read-pdf-asset"
import { readTextAssetContent } from "@/services/chat/read-text-asset"

export type FocusAssetInput = {
  assetId: string
  currentPage?: number
}

export async function buildFocusAssetSystemAppend(
  prisma: PrismaClient,
  focus: FocusAssetInput,
): Promise<string> {
  const asset = await prisma.asset.findFirst({
    where: { id: focus.assetId.trim(), deletedAt: null },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      mediaType: true,
    },
  })

  if (!asset) {
    return "\n\n[Focused file] The open document could not be loaded (asset not found)."
  }

  const isPdf =
    /\.pdf$/i.test(asset.originalFilename) ||
    (asset.mimeType ?? "").toLowerCase() === "application/pdf"

  const pdfPageNote =
    isPdf && focus.currentPage && focus.currentPage > 0
      ? ` The user is viewing **PDF page ${focus.currentPage}** in the preview (status bar counts from the file start). Context includes a **Current view** block with the printed/book page when known, plus the **text of that page** for highlights. When they ask what page they are on, answer with both PDF and printed pages. For section titles use [highlight-heading:"…"]; for other text use [highlight-current:"…"].`
      : ""

  if (isPdf) {
    const result = await readPdfAssetContent(prisma, {
      assetId: asset.id,
      ...(focus.currentPage && focus.currentPage > 0
        ? { page: focus.currentPage, maxPages: 3 }
        : { maxPages: 24 }),
    })
    if (typeof result.content === "string") {
      const truncatedNote = result.truncated
        ? "\n(Large book — chapter index may be partial, but the **current page text** is included for highlights.)"
        : ""
      return `\n\n--- Focused PDF: ${asset.originalFilename} (asset_id: ${asset.id}) ---${pdfPageNote}\n${result.content}\n---${truncatedNote}`
    }
    const msg =
      typeof result.message === "string" ? result.message : "Could not read PDF text."
    return `\n\n[Focused PDF: ${asset.originalFilename}] ${msg}${pdfPageNote}`
  }

  if (asset.mediaType === "IMAGE") {
    return `\n\n--- Focused image: ${asset.originalFilename} (asset_id: ${asset.id}) ---
The user has this **image** open in the Images library preview (not a PDF or document).
Answer only about what is visible in the attached image pixels.
Use [point-grid:"label",row,col,rows,cols] or [point-box:…] when they ask to point at or highlight something on the image.
Do not mention PDFs, chapters, or document pages.`
  }

  const textResult = await readTextAssetContent(prisma, { assetId: asset.id })
  if (typeof textResult.content === "string") {
    const truncatedNote = textResult.truncated ? "\n(Preview truncated.)" : ""
    return `\n\n--- Focused file: ${asset.originalFilename} (asset_id: ${asset.id}) ---\n\`\`\`\n${textResult.content}\n\`\`\`\n---${truncatedNote}`
  }

  return `\n\n[Focused file: ${asset.originalFilename} (asset_id: ${asset.id})] Binary or unsupported preview type — answer from metadata only unless the user describes the content.`
}
