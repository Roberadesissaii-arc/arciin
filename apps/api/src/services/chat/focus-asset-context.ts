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

  const pageNote =
    focus.currentPage && focus.currentPage > 0
      ? ` The user is viewing page ${focus.currentPage} in the preview. Prefer that page when answering page-specific questions.`
      : ""

  const isPdf =
    /\.pdf$/i.test(asset.originalFilename) ||
    (asset.mimeType ?? "").toLowerCase() === "application/pdf"

  if (isPdf) {
    const result = await readPdfAssetContent(prisma, { assetId: asset.id })
    if (typeof result.content === "string") {
      const truncatedNote = result.truncated
        ? "\n(Extract is partial — say so if the answer may be on a missing page.)"
        : ""
      return `\n\n--- Focused PDF: ${asset.originalFilename} (asset_id: ${asset.id}) ---${pageNote}\n${result.content}\n---${truncatedNote}`
    }
    const msg =
      typeof result.message === "string" ? result.message : "Could not read PDF text."
    return `\n\n[Focused PDF: ${asset.originalFilename}] ${msg}${pageNote}`
  }

  if (asset.mediaType === "IMAGE") {
    return `\n\n[Focused image: ${asset.originalFilename} (asset_id: ${asset.id})]${pageNote} The user has this image open in the library preview. Describe or answer from attached vision pixels when present; otherwise use filename and library context only.`
  }

  const textResult = await readTextAssetContent(prisma, { assetId: asset.id })
  if (typeof textResult.content === "string") {
    const truncatedNote = textResult.truncated ? "\n(Preview truncated.)" : ""
    return `\n\n--- Focused file: ${asset.originalFilename} (asset_id: ${asset.id}) ---${pageNote}\n\`\`\`\n${textResult.content}\n\`\`\`\n---${truncatedNote}`
  }

  return `\n\n[Focused file: ${asset.originalFilename} (asset_id: ${asset.id})]${pageNote} Binary or unsupported preview type — answer from metadata only unless the user describes the content.`
}
