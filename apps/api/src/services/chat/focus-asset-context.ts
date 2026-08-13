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

  // The control tags are the only way the viewer can act. Stated as a trailing
  // clause they were widely ignored: asked to highlight "Carbon Fixation", a
  // model replied `Highlighted "Carbon Fixation" — …` with no tag at all, so the
  // page stayed clean while the answer said otherwise. They are their own block
  // now, with the rule that makes them work — the quote must be text copied off
  // the page, because the viewer highlights by searching for it.
  const viewerControls = isPdf
    ? `

## Controlling the document viewer (required)
The reader cannot act on prose. To mark or move anything you MUST emit a tag; a
sentence saying you highlighted something highlights nothing.

Marks — pick the one the user asked for:
- highlight  → a colour wash behind the words (the default)
- underline  → a line under the words
- circle     → a hand-drawn loop around the words, like a pen
- box        → a rectangle around the words
- strike     → a line through the words

Write the mark name in place of <mark> below:
- On the page in view, a section title: [<mark>-heading:"exact title"]
- On the page in view, any other text:  [<mark>-current:"exact text"]
- On a specific file page:              [<mark>:PAGE:"exact text"]
- On a printed/book page:               [<mark>-printed:PAGE:"exact text"]

So "circle the summary table" is [circle-heading:"Summary Table"], and
"underline the net reaction" is [underline-current:"6 CO2 + 6 H2O"].

Scrolling: [goto-page:PAGE] · [goto-printed:PAGE] · [goto-chapter:N]

Rules:
- Use the mark the user named. If they did not name one, highlight.
- A request names a job, not a target. "Circle the key terms" does not mean
  searching the page for "the key terms" — decide which actual terms those are
  and target each one. Never quote the request back as a target.
- Asked to circle terms *and* explain them, pair each mark with a note on the
  same target, so every circled term gets its explanation beside it.
- The quoted text MUST be copied verbatim from the page text given below. The
  viewer finds the mark by searching the page for that string; a paraphrase, a
  translation, or a title you reworded will match nothing.
- Keep the quote short — a heading or one phrase. Do not quote a paragraph.
- One tag per thing they asked for. Asked to mark two things, emit two tags.
- Emit tags in the same reply as the sentence describing them. Tags are stripped
  before the user sees the text, so they never appear in the answer.
- If the text genuinely is not on the page, say so plainly and emit no tag.
  Never claim to have marked something you did not tag.

## A study pass
"Explain this page", "make study notes", "show me the important parts" and "what
should I remember for the exam" are one job: mark the few things that matter, and
explain them in your reply.

1. Read the page and pick the few things that actually matter.
2. Mark them: [highlight-current:"…"] for a key term or formula, [circle-heading:"…"]
   for a concept worth finding again, [underline-current:"…"] for an important phrase.
3. Explain those same things in your written reply, briefly and in order.

A typical page takes three to five marks. Fewer if the page is short. The marks
say where to look; the reply is where the explaining happens.`
    : ""

  const pdfPageNote =
    isPdf && focus.currentPage && focus.currentPage > 0
      ? ` The user is viewing **PDF page ${focus.currentPage}** in the preview (status bar counts from the file start). Context includes a **Current view** block with the printed/book page when known, plus the **text of that page** for highlights. When they ask what page they are on, answer with both PDF and printed pages.`
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
      return `\n\n--- Focused PDF: ${asset.originalFilename} (asset_id: ${asset.id}) ---${pdfPageNote}\n${result.content}\n---${truncatedNote}${viewerControls}`
    }
    const msg =
      typeof result.message === "string" ? result.message : "Could not read PDF text."
    return `\n\n[Focused PDF: ${asset.originalFilename}] ${msg}${pdfPageNote}${viewerControls}`
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
