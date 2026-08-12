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

import {
  DEFAULT_ANNOTATION_STYLE,
  styleFromRequest,
  type PdfAnnotationStyle,
} from "@/lib/files/pdf-annotation-style"
import type { PdfHighlightTarget } from "@/lib/files/pdf-highlight-types"

/** Verbs that mean "put a mark on the page", as opposed to asking about it. */
const HIGHLIGHT_VERB =
  "highlight|highlights|highlighted|underline|underlines|underlined|mark|marks|marked|" +
  "circle|circles|circled|box|boxes|boxed|outline|outlines|outlined|frame|frames|framed|" +
  "cross\\s+out|strike(?:\\s*through)?|point\\s+(?:to|at|out)|show\\s+me|find|locate|" +
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

/**
 * Words that describe where something is, not what it says.
 *
 * "Underline the Reduction heading" asks for the word Reduction; the page has no
 * text reading "Reduction heading", so leaving the noun on searched for a string
 * that cannot exist and marked nothing at all. Stripped from both ends, since
 * users write "the heading Reduction" just as often.
 *
 * `table` is deliberately absent: "Summary Table" is the heading itself.
 */
const STRUCTURE_NOUN =
  "headings?|headers?|sections?|titles?|lines?|paragraphs?|sentences?|paras?|" +
  "paragraph|paras|bits?|paras|paragraphs|rows?|columns?|entr(?:y|ies)|items?|" +
  "labels?|captions?|paragraph|bullets?|paragraphs"

/** Prepositions left behind by verbs like "put a box **around** X". */
const LEADING_NOISE =
  "around|round|over|under|on|at|to|near|through|across|next\\s+to|beside|" +
  "the|a|an|it|that|this|where|what|which|part|bit|text|words?|phrase|" +
  `says?|saying|said|is|are|about|for|in|of|${STRUCTURE_NOUN}`

function cleanTarget(value: string): string {
  let phrase = normalizePhrase(value.replace(FILLER, " "))

  // Peel one word at a time: "around the Summary Table" needs the preposition
  // and the article gone, and a single pass in a fixed order misses one of them.
  const leading = new RegExp(`^(?:${LEADING_NOISE})\\s+`, "i")
  for (let i = 0; i < 5; i++) {
    const next = phrase.replace(leading, "")
    if (next === phrase) break
    phrase = next
  }

  // Trailing structure word: "Reduction heading" → "Reduction". Never strip the
  // whole phrase — "the heading" on its own leaves nothing to search for.
  const trailing = new RegExp(`\\s+(?:${STRUCTURE_NOUN})$`, "i")
  const trimmedTail = phrase.replace(trailing, "")
  if (trimmedTail.trim()) phrase = trimmedTail

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
/**
 * Split a request that named more than one target.
 *
 * "highlight carbon fixation and then the other one is summary table" is two
 * jobs. Splitting on the connectives keeps each phrase whole — splitting on
 * every "and" would cut "ATP and NADPH Production" in half, so the connective
 * has to look like a list joint: "and then", "and also", ", and", or a bare
 * "and" followed by a fresh naming clause.
 */
const LIST_JOINT =
  /\s*(?:,\s*(?:and\s+)?|;\s*|\band\s+then\b|\band\s+also\b|\balso\b|\band\s+(?=the\s+other|another|second|secondly|next)|\bplus\b)\s*/i

/** "the other one that I want you to highlight is X" → "X". */
function stripNamingClause(part: string): string {
  return part
    .replace(/^.*?\b(?:the\s+other\s+one|another\s+one|the\s+second\s+one|the\s+next\s+one)\b.*?\bis\b\s*/i, "")
    .replace(/^.*?\bi\s+want\s+you\s+to\s+highlight\b\s*(?:is\s*)?/i, "")
    .replace(/^(?:the\s+other|another|second|next)\s+(?:one\s+)?(?:is\s+)?/i, "")
    .trim()
}

export function extractHighlightPhrases(userText: string): string[] {
  const raw = (userText || "").trim()
  if (!raw || !wantsPdfHighlight(raw)) return []

  // Quoted spans are unambiguous; if the user quoted, take every quote.
  const quotes = [...raw.matchAll(/["“'‘]([^"”'’]{2,80})["”'’]/g)]
    .map((m) => normalizePhrase(m[1] ?? ""))
    .filter(Boolean)
  if (quotes.length > 0) return dedupe(quotes)

  const stripped = raw.replace(FILLER, " ").replace(/\s+/g, " ")
  const afterVerb = stripped.match(new RegExp(`\\b(?:${HIGHLIGHT_VERB})\\b\\s*(.+)$`, "i"))
  const body = afterVerb?.[1] ?? stripped

  const parts = splitTrailingAnd(body.split(LIST_JOINT).filter((p) => p && p.trim()))
  if (parts.length <= 1) {
    const single = extractHighlightPhrase(raw)
    return single ? [single] : []
  }

  const out: string[] = []
  for (const part of parts) {
    const cleaned = cleanTarget(stripNamingClause(part))
    if (isSearchablePhrase(cleaned)) out.push(cleaned)
  }
  return dedupe(out)
}

/**
 * "A, B and C" — the last comma segment holds two targets joined by a bare
 * "and".
 *
 * Applied only when both sides read as targets in their own right, which is
 * what separates "carbon fixation and the summary table" (two headings) from
 * "ATP and NADPH Production" (one heading that contains the word).
 */
function splitTrailingAnd(parts: string[]): string[] {
  if (parts.length === 0) return parts
  const out = parts.slice(0, -1)
  const last = parts[parts.length - 1]!
  const at = last.search(/\s+\band\b\s+/i)
  if (at < 0) return parts
  const left = last.slice(0, at)
  const right = last.replace(/^[\s\S]{0,999}?\s+\band\b\s+/i, "")
  if (standaloneTarget(left) && standaloneTarget(right)) {
    out.push(left, right)
    return out
  }
  return parts
}

/** Distinguishes a target from half of a compound heading like "ATP and NADPH". */
function standaloneTarget(part: string): boolean {
  const t = cleanTarget(part)
  if (!isSearchablePhrase(t)) return false
  if (t.split(/\s+/).filter(Boolean).length >= 2) return true
  return t.length >= 6 && !/^[A-Z0-9]+$/.test(t)
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

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
/**
 * Phrases that describe the job rather than the page.
 *
 * "the key terms on this page" is an instruction; searching for it as text finds
 * either nothing or, worse, a long fuzzy span that then gets a circle drawn
 * round half a paragraph.
 */
const INSTRUCTION_PHRASE =
  /\b(?:key\s+terms?|important\s+(?:parts?|bits?|things?)|main\s+(?:ideas?|points?)|each\s+one|every\s+one|what\s+(?:it|they|each)\s+means?|on\s+this\s+page|in\s+this\s+(?:page|document|section)|the\s+whole\s+page)\b/i

function isSearchablePhrase(phrase: string): boolean {
  const p = phrase.trim()
  if (p.length < 3) return false
  if (INSTRUCTION_PHRASE.test(p)) return false
  if (/^(?:it|that|this|there|them|these|those|here|one)$/i.test(p)) return false
  // "highlight the heading" names a kind of thing, not a thing. Searching the
  // page for the word "heading" would mark whatever prose happened to use it.
  return !new RegExp(`^(?:${STRUCTURE_NOUN})$`, "i").test(p)
}

/**
 * The phrase the model quoted back.
 *
 * `Highlighted "Carbon Fixation" — …` is the shape a model produces when it
 * believes it did the job, and the quoted span is exactly what it meant to mark.
 */
/**
 * Every phrase the model named, in order.
 *
 * Asked for two highlights, a model answers with a list:
 *
 *   Done — I've highlighted both:
 *   * Carbon Fixation — the heading where RuBisCO fixes CO₂ onto RuBP.
 *   * Summary Table — the comparison table of Light-Dependent Reactions.
 *
 * No quotes anywhere, so quote-scanning finds nothing. Each bullet names its
 * target before the dash. This also repairs dictation: the request said
 * "Caravan fixation", and the model's list says "Carbon Fixation" — the phrase
 * that is actually on the page.
 */
export function extractPhrasesFromAnswer(assistantText: string): string[] {
  const text = (assistantText || "").trim()
  if (!text) return []

  const out: string[] = []
  for (const line of text.split(/\n/)) {
    const bullet = line.match(/^\s*(?:[*\-•]|\d+[.)])\s+(.+)$/)
    if (!bullet?.[1]) continue
    // The target is the head of the item, before the explanatory dash or colon.
    const head = bullet[1].split(/\s+[—–]\s+|\s+-\s+|:\s+/)[0] ?? ""
    const phrase = normalizePhrase(head.replace(/\*\*/g, "").replace(/`/g, ""))
    if (isSearchablePhrase(phrase) && phrase.split(/\s+/).length <= 8) out.push(phrase)
  }

  if (out.length > 0) return dedupe(out)

  const quoted = [...text.slice(0, 600).matchAll(/["“]([^"”\n]{2,80})["”]/g)]
    .map((m) => normalizePhrase(m[1] ?? ""))
    .filter((p) => isSearchablePhrase(p))
  return dedupe(quoted)
}

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
  /** Overrides what the request implies — used when a tag already named one. */
  style?: PdfAnnotationStyle
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

  // Both sources, not one: the request carries what the user meant, the answer
  // carries the spelling that is actually on the page. Dictation turned "carbon
  // fixation" into "Caravan fixation" — unfindable — while the model's own list
  // had it right. The page search drops whichever phrases it cannot locate, so
  // offering both costs nothing and rescues the turn.
  const phrases = dedupe([
    ...extractHighlightPhrases(userText),
    ...extractPhrasesFromAnswer(assistantText),
  ]).filter(isSearchablePhrase)

  // "Circle the summary table" has to draw a circle. Picking the mark from the
  // user's own verb is the point — defaulting every request to a highlight
  // would make the other verbs decorative.
  const style = input.style ?? styleFromRequest(userText) ?? DEFAULT_ANNOTATION_STYLE

  return phrases.slice(0, MAX_INFERRED_HIGHLIGHTS).map((quote) => ({
    page: currentPage,
    quote,
    kind: looksLikeHeading(quote) ? ("heading" as const) : ("default" as const),
    style,
  }))
}

/** A request cannot sensibly mark more than a handful of things at once. */
const MAX_INFERRED_HIGHLIGHTS = 6
