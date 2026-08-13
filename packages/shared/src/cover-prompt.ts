/**
 * The prompt behind a generated document cover.
 *
 * Pure so it can be read and tested on its own: it is the part of cover
 * generation that decides whether the result is worth looking at, and it is far
 * cheaper to pin here than by generating images.
 */

/** Enough of the document to know what it is; more is wasted tokens. */
const CONTEXT_CHARS = 4_000

/**
 * Turn what the document says into something worth looking at.
 *
 * Deliberately not a summary. A cover has to work at the size of a card, so it
 * asks for one clear subject and forbids text — generated lettering is the
 * fastest way to make a thumbnail look wrong, and the card already shows the
 * title underneath.
 */
export function buildCoverPrompt(input: { filename: string; excerpt: string }): string {
  const title = input.filename.replace(/\.[a-z0-9]+$/i, "").trim()
  const excerpt = input.excerpt.replace(/\s+/g, " ").trim().slice(0, CONTEXT_CHARS)

  return [
    `Cover art for a document titled "${title}".`,
    excerpt ? `It is about: ${excerpt}` : "",
    "Illustrate the single main subject in a clean editorial style.",
    "One clear focal subject, uncluttered composition, readable as a small thumbnail.",
    "No text, no lettering, no numbers, no watermarks, no borders.",
  ]
    .filter(Boolean)
    .join(" ")
}


/**
 * What the text model is asked to produce.
 *
 * The saving here is not in tokens on the image bill — image APIs charge per
 * image however long the prompt is. It is that a distilled brief produces a
 * usable cover first time, and a regeneration costs a whole image while this
 * costs a fraction of a cent. Raw document prose makes a poor prompt: an image
 * model latches onto stray terms, which is how "ATP" and "G3P" ended up drawn
 * as labels on a cover whose prompt forbade text.
 */
export function buildCoverBriefInstruction(filename: string): string {
  const title = filename.replace(/\.[a-z0-9]+$/i, "").trim()
  return [
    `You are art-directing the cover for a document titled "${title}".`,
    "Read the excerpt and reply with ONE sentence describing a single image.",
    "",
    "Rules:",
    "- Name one concrete subject and its setting. Something that can be drawn.",
    "- Prefer the thing the document is about over a metaphor for it.",
    "- No words, letters, numbers, labels, diagrams-with-captions or charts.",
    "- No mention of the title, the document, paper, books or reading.",
    "- Under 30 words. No preamble, no quotes, no explanation — the sentence only.",
  ].join("\n")
}

/**
 * Turn the model's brief into the final image prompt.
 *
 * Style and the prohibition on lettering are appended here rather than trusted
 * to the brief: those are properties of every cover, and a model asked to
 * remember them each time will eventually not.
 */
export function buildCoverPromptFromBrief(brief: string): string {
  const subject = brief.replace(/\s+/g, " ").replace(/^["'\u201c]|["'\u201d]$/g, "").trim()
  return [
    subject,
    "Clean editorial illustration, one clear focal subject, uncluttered composition,",
    "readable as a small thumbnail.",
    "No text, no lettering, no numbers, no watermarks, no borders.",
  ].join(" ")
}
