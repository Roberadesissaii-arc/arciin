/**
 * Illustrations inside a Canvas draft.
 *
 * The assistant marks where a picture belongs; the client draws it. Keeping the
 * marker in the text means the draft stays a document — it can be edited,
 * saved and exported with the illustration in place, and a marker whose image
 * never arrives degrades to a caption rather than a hole.
 */

/** `[image: a chloroplast lit from above]` on a line of its own. */
const IMAGE_MARKER = /\[image:\s*([^\]\n]{4,200})\]/gi

export type CanvasImageMarker = {
  /** Position in the source text, so the renderer can split around it. */
  index: number
  raw: string
  description: string
}

export function findCanvasImageMarkers(text: string): CanvasImageMarker[] {
  const out: CanvasImageMarker[] = []
  if (!text) return out
  IMAGE_MARKER.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = IMAGE_MARKER.exec(text)) !== null) {
    const description = (match[1] ?? "").replace(/\s+/g, " ").trim()
    if (!description) continue
    out.push({ index: match.index, raw: match[0], description })
  }
  return out
}

export function stripCanvasImageMarkers(text: string): string {
  return (text || "").replace(IMAGE_MARKER, "")
}

/**
 * What the assistant is told about illustrating.
 *
 * Restrictive on purpose. Every picture is a paid generation and a document
 * padded with decoration is worse than a plain one, so this asks for images
 * only where a picture carries something the prose cannot.
 */
export function buildCanvasImageInstruction(): string {
  return [
    "",
    "## Illustrations",
    "You may illustrate this document. Place [image: description of the picture] on its own line",
    "where a picture explains something the words are labouring over — a structure, a process, a",
    "comparison. The description should name one concrete scene in under 25 words.",
    "",
    "- At most 3 in a document, and none at all is a perfectly good answer.",
    "- Never illustrate for decoration, and never illustrate a heading.",
    "- Ask for no words, labels or captions inside the picture; the prose does that.",
    "- Put it after the paragraph it illustrates, never mid-sentence.",
  ].join("\n")
}
