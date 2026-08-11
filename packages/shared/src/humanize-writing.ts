/**
 * Humanised writing guidance.
 *
 * Long-form drafts produced by a model have a recognisable signature: even
 * sentence rhythm, a small set of over-formal words, stock transitions,
 * reflexive rule-of-three grouping, and a conclusion that restates the
 * introduction. Readers notice it, and detectors measure it.
 *
 * The point of this module is not evasion. Every marker below is probabilistic,
 * no checklist defeats a specific classifier, and writing engineered to fool one
 * tends to read worse. The point is that the same habits that make text
 * *detectable* are the habits that make it *dull* — even rhythm, vague nouns,
 * hedged claims, no concrete detail. Fixing them is ordinary good editing.
 *
 * Two forms are exported deliberately:
 *
 *   - `HUMANIZE_DIRECTIVE` is compact enough to sit in the system prompt of
 *     every long-form request without crowding out the user's own context.
 *   - `HUMANIZE_FULL_BRIEF` is the explicit version, sent only when the writer
 *     asks for it with `/humanize`, where spending the tokens is the point.
 */

/** Words whose over-use marks default model prose. Illustrative, not a blacklist. */
export const AI_CODED_VOCABULARY = [
  "delve", "tapestry", "realm", "leverage", "unlock", "unleash", "robust",
  "seamless", "seamlessly", "holistic", "synergy", "paradigm", "comprehensive",
  "facilitate", "foster", "fostering", "underscore", "underscores", "interplay",
  "testament", "landscape", "meticulous", "meticulously", "pivotal", "crucial",
  "intricate", "intricacies", "showcase", "showcasing", "boasts", "garner",
  "bolstered", "multifaceted", "transformative", "groundbreaking", "revolutionize",
  "navigate", "journey", "bespoke", "empower", "harness", "utilize", "vibrant",
  "enduring", "align with", "emphasizing", "highlighting", "enhance",
] as const

/** Openers, closers and throat-clearing that read as machine-generated. */
export const FORMULAIC_PHRASES = [
  "in today's fast-paced world", "in today's digital age", "in conclusion",
  "overall, it is clear that", "it's worth noting that", "it's important to note that",
  "it is important to note", "it's also worth mentioning", "to summarize", "in summary",
  "furthermore", "moreover", "additionally",
] as const

/**
 * Compact guidance for the system prompt.
 *
 * Written as instructions to follow while drafting rather than a list of
 * forbidden words, because a blacklist produces stilted avoidance — the writer
 * dodges "crucial" and reaches for "vital" and nothing improves.
 */
export const HUMANIZE_DIRECTIVE = [
  "Write like a person, not like default model prose:",
  "- Vary sentence length deliberately. Mix short blunt sentences with long ones. An even rhythm of medium, balanced sentences is the most recognisable machine tell there is.",
  "- Avoid over-formal filler: delve, tapestry, realm, leverage, robust, seamless, holistic, comprehensive, foster, underscore, pivotal, crucial, intricate, showcase, testament, landscape, meticulous, multifaceted, transformative.",
  "- Drop stock transitions and throat-clearing: furthermore, moreover, additionally, it's worth noting that, it's important to note that, in today's fast-paced world, in conclusion. Just continue the thought, or use plain connectors — but, so, also.",
  '- Use the "It\'s not X, it\'s Y" construction at most once in a piece, ideally never. Same for "not just X, but Y". It is the single most recognised tell and it survives paraphrasing.',
  "- Do not group things in threes by reflex. Two examples, or four, when that is what the material has.",
  "- Prefer concrete specifics — names, numbers, dates, textures — over statements that could apply to anything. Vagueness is the biggest tell of all.",
  "- Do not hedge every claim or present both sides of everything. Take a position where the evidence supports one.",
  "- Vary paragraph shape. Not every paragraph is topic sentence, three supports, wrap-up.",
  "- Go easy on em dashes and over-tidy punctuation.",
  "- Do not over-signpost in short pieces (First… Second… Finally…, In this section we will discuss…).",
  "- Let the conclusion advance the argument rather than restating the introduction.",
  "Do not overcorrect into forced quirkiness, random fragments or slang — that is its own kind of artificial.",
].join("\n")

/** The explicit brief, used when the writer invokes /humanize. */
export const HUMANIZE_FULL_BRIEF = [
  HUMANIZE_DIRECTIVE,
  "",
  "Why these specifically: detectors measure predictability (perplexity) and how much sentence-to-sentence variation there is (burstiness). Model prose scores low on both. Human readers pick up the same thing as monotony. The lexical tells shift by model era — 'delve' was a strong signal in 2023–24 and has faded since — but the structural habits (balanced antithesis, rule-of-three, symmetrical paragraphs, absence of lived detail) have proven far stickier, so weight those over any word list.",
  "",
  "These are probabilistic markers, not proof, and this is not about beating a classifier — text written to fool one usually reads worse. The overlap is the useful part: the habits that make writing detectable are the habits that make it dull.",
].join("\n")

export type HumanizeMode = "off" | "default" | "explicit"

/**
 * Whether a request is long-form enough for the guidance to be worth its tokens.
 *
 * Applied to essays, reports and articles — the writing where voice matters and
 * where the drafting habits above actually show up. A one-line answer or a
 * command explanation has no room to develop a rhythm worth correcting.
 */
export function shouldHumanizeByDefault(input: {
  canvas?: boolean
  userText?: string
}): boolean {
  if (input.canvas) return true

  const text = (input.userText ?? "").toLowerCase()
  if (!text.trim()) return false

  return /\b(essay|article|paper|report|blog\s*post|newsletter|cover\s*letter|write\s*(me\s*)?(an?|the)\s+\w+|draft|rewrite|proofread|polish)\b/.test(
    text,
  )
}

/** Guidance to append to the system prompt for this turn, if any. */
export function humanizeInstructionFor(mode: HumanizeMode): string {
  if (mode === "off") return ""
  return mode === "explicit" ? HUMANIZE_FULL_BRIEF : HUMANIZE_DIRECTIVE
}

// ---------------------------------------------------------------------------
// Auditing existing text
// ---------------------------------------------------------------------------

export type HumanizeFinding = {
  kind: "vocabulary" | "phrase" | "antithesis" | "rule-of-three" | "uniform-rhythm"
  detail: string
  count: number
}

/**
 * Flag the tells present in a passage.
 *
 * Used by `/humanize` when the writer passes existing text, so the rewrite can
 * name what it changed instead of silently reshuffling the prose.
 */
export function auditHumanTells(text: string): HumanizeFinding[] {
  const findings: HumanizeFinding[] = []
  const lower = text.toLowerCase()

  const vocabHits = AI_CODED_VOCABULARY.filter((word) =>
    new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower),
  )
  if (vocabHits.length > 0) {
    findings.push({
      kind: "vocabulary",
      detail: vocabHits.join(", "),
      count: vocabHits.length,
    })
  }

  const phraseHits = FORMULAIC_PHRASES.filter((phrase) => lower.includes(phrase))
  if (phraseHits.length > 0) {
    findings.push({ kind: "phrase", detail: phraseHits.join(", "), count: phraseHits.length })
  }

  // "It's not X, it's Y" and its relatives.
  const antithesis =
    text.match(/\b(?:it'?s|this is|that'?s)\s+not\s+[^.,;]{1,60},\s*(?:it'?s|but)\b/gi) ?? []
  const notJust = text.match(/\bnot\s+(?:just|only)\s+[^.,;]{1,60},?\s*but\b/gi) ?? []
  if (antithesis.length + notJust.length > 0) {
    findings.push({
      kind: "antithesis",
      detail: '"It\'s not X, it\'s Y" / "not just X, but Y"',
      count: antithesis.length + notJust.length,
    })
  }

  const tripleAdjectives = text.match(/\b\w+,\s+\w+,\s+and\s+\w+\b/g) ?? []
  if (tripleAdjectives.length >= 3) {
    findings.push({
      kind: "rule-of-three",
      detail: "repeated groups of exactly three",
      count: tripleAdjectives.length,
    })
  }

  // Low variance in sentence length is the structural signal detectors measure.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().split(/\s+/).length)
    .filter((n) => n > 2)
  if (sentences.length >= 6) {
    const mean = sentences.reduce((a, b) => a + b, 0) / sentences.length
    const variance =
      sentences.reduce((total, n) => total + (n - mean) ** 2, 0) / sentences.length
    const spread = Math.sqrt(variance) / (mean || 1)
    if (spread < 0.35) {
      findings.push({
        kind: "uniform-rhythm",
        detail: `sentence lengths cluster tightly (spread ${spread.toFixed(2)}, want > 0.35)`,
        count: sentences.length,
      })
    }
  }

  return findings
}
