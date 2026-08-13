/**
 * A picture of the page, for a model that can look at it.
 *
 * Reading the text layer tells the assistant what the page says and nothing
 * about how it sits: which lines are headings, where the whitespace is, whether
 * a run of characters is a formula or a table row. That is why marks landed on
 * blank paper and notes were planned for margins too thin to hold them — the
 * assistant was choosing targets it could not see.
 *
 * The image informs the *choice*. Targets stay verbatim text and are still
 * resolved against the text layer, because a model asked for coordinates guesses
 * them and the text layer knows exactly where a phrase is.
 */

import { fetchPdfDocument, releasePdfDocument } from "@/lib/files/fetch-pdf-document"

/**
 * Wide enough for a model to read a heading, small enough to stay cheap.
 *
 * Vision pricing is per tile, so this is a real cost knob rather than a
 * cosmetic one; 1000px keeps body text legible on an A4 page.
 */
const VISION_PAGE_WIDTH = 1000

/** JPEG quality. Text stays crisp well below 1. */
const VISION_QUALITY = 0.82

export type PdfPageImage = {
  /** Base64 without the data: prefix, which is what the chat API expects. */
  base64: string
  width: number
  height: number
}

export async function renderPdfPageToImage(
  fileUrl: string,
  pageNumber: number,
): Promise<PdfPageImage | null> {
  if (!fileUrl || pageNumber < 1) return null

  let acquired = false
  try {
    const pdf = await fetchPdfDocument(fileUrl)
    acquired = true
    if (pageNumber > pdf.numPages) return null

    const page = await pdf.getPage(pageNumber)
    try {
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: VISION_PAGE_WIDTH / base.width })

      const canvas = document.createElement("canvas")
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      const ctx = canvas.getContext("2d")
      if (!ctx) return null

      // White first: a PDF page is paper, and an unpainted canvas is
      // transparent, which encodes to black in JPEG.
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise

      const dataUrl = canvas.toDataURL("image/jpeg", VISION_QUALITY)
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1)
      if (!base64) return null

      return { base64, width: canvas.width, height: canvas.height }
    } finally {
      page.cleanup()
    }
  } catch {
    // A page that will not rasterise is not a reason to fail the turn; the
    // assistant falls back to the text layer, which is what it had before.
    return null
  } finally {
    if (acquired) releasePdfDocument(fileUrl)
  }
}

/**
 * What to do with the picture.
 *
 * Kept short and placed with the user's turn, for the same reason the study
 * instruction is: a requirement buried in a long system prompt loses to the
 * model's habit of simply answering.
 */
export function buildPageVisionInstruction(): string {
  return [
    "",
    "",
    "[PAGE IMAGE ATTACHED]",
    "The image is this page as the student sees it. Use it to judge what the text alone cannot:",
    "- which lines are headings, and which are body text, captions, table rows or formulas",
    "- where the page has empty space, and where it is dense",
    "- what actually matters visually on this page",
    "Choose your targets by looking, then quote them EXACTLY as they appear in the page text",
    "given below — the text layer is what resolves a target to a position, so a quote that",
    "differs by a character will not be found. Never give coordinates; they are worked out here.",
    "Do not mark a formula, a table row or a running header unless the student asked about it.",
  ].join("\n")
}
