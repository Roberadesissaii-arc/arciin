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

