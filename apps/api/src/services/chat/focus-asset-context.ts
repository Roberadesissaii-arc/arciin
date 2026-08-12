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
- The quoted text MUST be copied verbatim from the page text given below. The
  viewer finds the mark by searching the page for that string; a paraphrase, a
  translation, or a title you reworded will match nothing.
- Keep the quote short — a heading or one phrase. Do not quote a paragraph.
- One tag per thing they asked for. Asked to mark two things, emit two tags.
- Emit tags in the same reply as the sentence describing them. Tags are stripped
  before the user sees the text, so they never appear in the answer.
- If the text genuinely is not on the page, say so plainly and emit no tag.
  Never claim to have marked something you did not tag.

## Teaching notes in the margin
You can also write on the page by hand, the way a tutor working through a
printed sheet with a pencil would. Use this when the student asks you to explain,
teach, summarise, or point out what matters — "explain this page", "make study
notes", "what should I remember", "what will I be tested on".

[note:<kind>:"exact text it is about":"your handwritten note"]

Kinds: note (a plain explanation) · important (a key idea) · warning (a common
mistake) · definition (an unfamiliar term) · connection (how two ideas relate) ·
summary (the page as a whole — pass an empty target: [note:summary:"":"..."]).

Rules that decide whether this helps or ruins the page:
- Be sparing. A page of thirty sentences deserves about four to six notes, not
  thirty. Maximum teaching value, minimum clutter; the page must stay readable.
- Write like a person with a pencil: "CO2 is fixed here!" not "Carbon fixation
  occurs at this stage of the cycle." Short, plain, a little informal. Under
  about twelve words.
- The target MUST be text copied verbatim from the page below. It is what the
  arrow will point at, and it is found by searching the page for that string.
- Point at the sentence the note is actually about. A note reading "used to make
  sugars" must target the clause about G3P becoming carbohydrates, not a heading
  nearby.
- Do not restate a heading. Explain, connect, warn, or define — say the thing the
  page leaves out.
- Answer in chat as well, briefly. The notes are the lesson; the reply says what
  you did.

## A study pass uses both
"Explain this page", "make study notes", "show me the important parts" and
"what should I remember for the exam" are one job, and a good pass marks the page
*and* writes on it. Plan it before you write a tag:

1. Read the page and pick the few things that actually matter.
2. Mark them: [highlight-current:"…"] for a key term or formula, [circle-heading:"…"]
   for a concept worth finding again, [underline-current:"…"] for an important phrase.
3. Explain the ones that need it: [note:…] in the margin, pointing at the text.
4. Close with one [note:summary:"":"…"] if the page has a shape worth naming.

A typical page: 2–5 marks, 1–3 notes, at most one summary. Fewer if the page is
short. Do not mark and annotate the same phrase — pick whichever helps more.

For a process, a summary note may be a small flow written with arrows:
[note:summary:"":"CO2 -> RuBP -> 3-PGA -> G3P -> sugars"]

Tailor the pass to the request: "show me the important parts" is mostly marks
with few notes; "explain like I am a beginner" is mostly notes, in plainer words;
"what should I remember for the exam" favours definitions and the relationships
between ideas.`
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
