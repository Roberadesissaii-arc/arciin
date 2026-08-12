/**
 * Work out what to highlight when the model answered in prose.
 *
 * The document panel highlights by tag: the model is asked to emit
 * `[highlight-heading:"…"]` and the viewer searches the page for that text. When
 * the model instead replies `Highlighted "Carbon Fixation" — the first phase of
 * the Calvin Cycle…`, the tag parser finds nothing and the page stays clean
 * while the answer claims otherwise. That is the worst failure available: the
 * user is told the thing happened.
 *
 * So the tag stays the fast path, and this is the floor under it. If the user
 * asked to highlight something and no tag arrived, the phrase is recovered from
 * what they typed — falling back to the phrase the model quoted back — and
 * highlighted on the page they are looking at.
 */

import type { PdfHighlightTarget } from "@/lib/files/pdf-highlight-types"

/** Verbs that mean "put a mark on the page", as opposed to asking about it. */
const HIGHLIGHT_VERB =
  "highlight|underline|mark|circle|point\\s+(?:to|at|out)|show\\s+me|find|locate|" +
  "take\\s+me\\s+to|jump\\s+to|go\\s+to|where\\s+is"

const HIGHLIGHT_INTENT = new RegExp(`\\b(?:${HIGHLIGHT_VERB})\\b`, "i")

/**
 * Dictation filler. These arrive mid-sentence from speech-to-text and would
 * otherwise be picked up as part of the phrase to search for.
 */
const FILLER =
  /\b(?:you know|i mean|like,|please|can you|could you|would you|kindly|for me|okay|ok)\b/gi

/**
 * Speech-to-text puts sentence breaks inside phrases — "carbon. Fixation." is
 * one term, not two sentences. Punctuation that trails a word is dropped;
 * a dot between digits ("3.2") is structure and survives.
 */
function normalizePhrase(value: string): string {
  return value
    .replace(/["'“”‘’]/g, " ")
    .replace(/(?<!\d)[.,;:!?]+(?=\s|$)/g, " ")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function cleanTarget(value: string): string {
  let phrase = normalizePhrase(value.replace(FILLER, " "))
  // Leading connectives left behind once the verb is removed.
  phrase = phrase.replace(
    /^(?:the|a|an|it|that|this|where|what|which|part|section|bit|text|word|words|phrase|title|heading)\s+/i,
    "",
  )
  phrase = phrase.replace(/^(?:says?|saying|said|is|are|about|on|for|in|of)\s+/i, "")
  // A trailing clause the user tacked on is not part of the phrase.
  phrase = phrase.replace(/\s+(?:please|thanks|thank you)$/i, "")
  return phrase.trim()
}

/** True when the user asked for something to be marked on the page. */
export function wantsPdfHighlight(userText: string): boolean {
  return HIGHLIGHT_INTENT.test(userText || "")
}

/**
 * Pull the phrase to search for out of the user's request.
 *
 * Quoted text wins outright — a user who typed quotes has already told us where
 * the phrase begins and ends.
 */
export function extractHighlightPhrase(userText: string): string | null {
  const raw = (userText || "").trim()
  if (!raw) return null
  if (!wantsPdfHighlight(raw)) return null

  const quoted = raw.match(/["“'‘]([^"”'’]{2,80})["”'’]/)
  if (quoted?.[1]) {
    const phrase = normalizePhrase(quoted[1])
    if (phrase) return phrase
  }

  const stripped = raw.replace(FILLER, " ").replace(/\s+/g, " ")

  // "where/what it says X", "the part that says X" — the verb is `says`, and
  // everything after it is the phrase.
  const says = stripped.match(/\b(?:where|what|which|the\s+part|the\s+bit)?\s*it\s+says\s+(.+)$/i)
  if (says?.[1]) {
    const phrase = cleanTarget(says[1])
    if (phrase) return phrase
  }

  const afterVerb = stripped.match(new RegExp(`\\b(?:${HIGHLIGHT_VERB})\\b\\s*(.+)$`, "i"))
  if (afterVerb?.[1]) {
    const phrase = cleanTarget(afterVerb[1])
    if (isSearchablePhrase(phrase)) return phrase
  }

  return null
}

/**
 * "highlight it" names nothing to search for. Returning the pronoun would beat
 * the model's own quote to the fallback and highlight the word "it" wherever it
 * appears on the page.
 */
function isSearchablePhrase(phrase: string): boolean {
  const p = phrase.trim()
  if (p.length < 3) return false
  return !/^(?:it|that|this|there|them|these|those|here|one)$/i.test(p)
}

/**
 * The phrase the model quoted back.
 *
 * `Highlighted "Carbon Fixation" — …` is the shape a model produces when it
 * believes it did the job, and the quoted span is exactly what it meant to mark.
 */
export function extractQuotedPhraseFromAnswer(assistantText: string): string | null {
  const text = (assistantText || "").trim()
  if (!text) return null
  const head = text.slice(0, 400)
  const quoted = head.match(/["“]([^"”\n]{2,80})["”]/)
  if (!quoted?.[1]) return null
  const phrase = normalizePhrase(quoted[1])
  return phrase || null
}

/**
 * A short phrase with no sentence punctuation is a section title, and the page
 * search scores headings differently — "Carbon Fixation" should land on the
 * heading, not on the first sentence that happens to contain both words.
 */
export function looksLikeHeading(phrase: string): boolean {
  const words = phrase.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 6) return false
  return !/[.!?]/.test(phrase)
}

export type InferHighlightInput = {
  userText: string
  assistantText: string
  currentPage: number
  maxPage?: number
}

/**
 * Highlight targets for a turn where the model emitted no tag.
 *
 * Returns an empty array unless the user actually asked for a highlight — an
 * answer that merely mentions a phrase must not paint the page.
 */
export function inferPdfHighlightTargets(
  input: InferHighlightInput,
): PdfHighlightTarget[] {
  const { userText, assistantText, currentPage, maxPage } = input
  if (!wantsPdfHighlight(userText)) return []
  if (!Number.isFinite(currentPage) || currentPage < 1) return []
  if (maxPage && maxPage > 0 && currentPage > maxPage) return []

  const phrase = extractHighlightPhrase(userText) ?? extractQuotedPhraseFromAnswer(assistantText)
  if (!phrase) return []
  // A single short token like "it" is not a search term.
  if (phrase.length < 3) return []

  return [
    {
      page: currentPage,
      quote: phrase,
      kind: looksLikeHeading(phrase) ? "heading" : "default",
    },
  ]
}
