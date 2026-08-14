/**
 * Every prompt the book feature sends.
 *
 * Three of them: plan the book and write chapter one, write chapter N, and
 * repair a chapter that failed validation. Kept in one file because they have
 * to stay consistent with each other — the plan promises a shape that the
 * chapter prompt relies on and the validator enforces, and those three drifting
 * apart is the failure this separation exists to prevent.
 */

import { buildMemoryReportInstruction, manuscriptTail, renderMemoryForPrompt } from "./book-memory"
import type { ChapterRejection } from "./book-validator"
import type { BookChapter, BookProject } from "./types"

const SHARED_RULES = [
  "Write real prose, not an outline. No bullet summaries standing in for a chapter,",
  'no "in this chapter we will", no notes to the reader about what you are doing.',
  "Every claim gets its own sentences: scenes, examples, named specifics, argument.",
  "Do not pad with restatement — a paragraph that only rephrases the one above it",
  "is worse than a shorter chapter.",
].join(" ")

/**
 * What the manuscript may and may not contain.
 *
 * The renderer sets the page — centring, indents, chapter breaks — so the model
 * must not try to. A chapter that arrives pre-formatted with spaces and rules
 * puts that formatting into the stored document, where it survives export,
 * pollutes what the reader copies, and confuses the parser that decides which
 * chapters exist.
 */
const MANUSCRIPT_RULES = [
  "MANUSCRIPT FORMAT — this is a book, and the page is set for you:",
  "- Plain paragraphs separated by a single blank line. Nothing else.",
  "- Never indent with spaces or tabs, never centre anything by padding it,",
  "  never draw rules (---, ===, ***) as decoration, and never add page numbers.",
  "- Never write progress or workflow lines. No \"Here is Chapter 4\", no",
  '  "chapter complete", no "next I will write", no notes to the reader.',
  "- Never restate the book title or the Contents inside a chapter.",
  "- Dialogue is ordinary prose in its own paragraph. No speaker labels,",
  "  no bullets, no bold names.",
  "- For a genuine change of time, place or viewpoint mid-chapter, put a line",
  "  containing exactly:  * * *   — and only when the prose really turns.",
].join("\n")

/** Default shape when the brief does not ask for something else. */
const DEFAULT_CHAPTER_RANGE = "8 to 14 chapters"
const DEFAULT_WORDS = "1,200 to 2,000 words"

/**
 * How long a book the brief is asking for.
 *
 * Read from the reader's own words rather than fixed, so "a short book on X" and
 * "a 30-chapter textbook on X" both get a sensible plan without the orchestrator
 * needing to know anything about lengths.
 */
export function inferPlanShape(brief: string): { chapters: string; words: string } {
  const t = brief.toLowerCase()

  const explicit = t.match(/\b(\d{1,3})\s*[- ]?\s*chapters?\b/)
  if (explicit) {
    const n = Number(explicit[1])
    if (Number.isFinite(n) && n >= 2 && n <= 200) {
      return { chapters: `exactly ${n} chapters`, words: DEFAULT_WORDS }
    }
  }

  if (/\b(short|novella|brief|quick|little)\b/.test(t)) {
    return { chapters: "5 to 7 chapters", words: "1,000 to 1,600 words" }
  }
  if (/\b(textbook|manual|handbook|reference|comprehensive|exhaustive)\b/.test(t)) {
    return { chapters: "14 to 20 chapters", words: "1,500 to 2,500 words" }
  }
  return { chapters: DEFAULT_CHAPTER_RANGE, words: DEFAULT_WORDS }
}

/**
 * The opening turn: title, premise, the whole plan, and chapter one.
 *
 * The full outline is demanded even though only one chapter gets written,
 * because it is what every later turn steers by — and, now that continuation is
 * automatic, what decides when the book stops. Without it the orchestrator has
 * no idea how many chapters it is committing the reader to.
 */
export function buildPlanPrompt(brief: string): string {
  const topic = brief.trim() || "a subject you judge worth a book, and say why you chose it"
  const shape = inferPlanShape(brief)

  return [
    `Write a book: ${topic}`,
    "",
    "This is a real book, written one chapter per turn — not an article, not a summary.",
    "In THIS turn produce exactly the following, in this order, and nothing else:",
    "",
    "1. `# <the book's title>` — a real title, not the topic restated.",
    "2. One short paragraph: what this book argues or tells, and who it is for.",
    `3. \`## Contents\` — the complete chapter list, ${shape.chapters}, every one`,
    "   numbered, in this exact form, one per line:",
    "   `1. Chapter Title — the one thing this chapter does`",
    "   Plan the whole arc now, and make each line specific enough that a chapter",
    "   cannot wander into the next one's material. Later turns follow this list",
    "   exactly, so a chapter you forget here never gets written.",
    "4. `## Chapter 1: <title from the list>` — then chapter one IN FULL.",
    `   ${shape.words}. This is the chapter itself, not a description of it.`,
    "",
    SHARED_RULES,
    "",
    MANUSCRIPT_RULES,
    "- Do not add a subtitle, author, dedication, copyright or epigraph unless",
    "  the brief supplied one. An invented author line is a false claim about a",
    "  real person.",
    "",
    "Stop at the end of chapter 1. Do not begin chapter 2 and do not write a",
    "closing note — the rest of the book is written in the turns after this one.",
    buildMemoryReportInstruction(),
  ].join("\n")
}

/**
 * One chapter, with everything it needs and nothing it does not.
 *
 * The context is assembled rather than dumped: brief, outline position, memory,
 * this chapter's contract, what later chapters have reserved, and the tail. The
 * manuscript itself is never resent — see book-memory for why.
 */
export function buildChapterPrompt(input: {
  project: BookProject
  manuscript: string
  chapter: number
}): string {
  const { project, chapter } = input
  const planned = project.chapters.find((c) => c.number === chapter)
  const later = project.chapters.filter((c) => c.number > chapter)
  const isLast = project.chapters.length > 0 && chapter >= project.chapters.length
  const memory = renderMemoryForPrompt(project.memory, chapter - 1)
  const tail = manuscriptTail(input.manuscript)

  const lines: string[] = [
    `Continue the book "${project.title}". Write CHAPTER ${chapter} and stop.`,
    "",
    `ORIGINAL BRIEF: ${project.brief}`,
    "",
  ]

  if (memory) lines.push(memory, "")

  if (planned) {
    lines.push(
      `THIS CHAPTER — ${chapter}. ${planned.title}`,
      planned.summary ? `  Its job: ${planned.summary}` : "",
      planned.purpose ? `  Why it exists: ${planned.purpose}` : "",
      planned.requiredBeats?.length
        ? `  Must include: ${planned.requiredBeats.join("; ")}`
        : "",
      planned.mustNotResolve?.length
        ? `  Must NOT resolve: ${planned.mustNotResolve.join("; ")}`
        : "",
      "",
    )
  } else {
    lines.push(
      `THIS CHAPTER — ${chapter}. The outline does not name it. Write the chapter`,
      "the book needs next and title it accordingly.",
      "",
    )
  }

  if (later.length > 0) {
    lines.push(
      "RESERVED FOR LATER — do not spend this material here:",
      ...later.slice(0, 8).map((c) => `  ${c.number}. ${c.title}${c.summary ? ` — ${c.summary}` : ""}`),
      "",
    )
  }

  if (tail) {
    lines.push(
      "THE MANUSCRIPT CURRENTLY ENDS HERE. Pick up from it in the same voice, tense",
      "and level of detail — the seam must not be visible:",
      "",
      "<<<MANUSCRIPT-TAIL",
      tail,
      "MANUSCRIPT-TAIL",
      "",
    )
  }

  lines.push(
    `Output ONLY chapter ${chapter}, starting with the heading \`## Chapter ${chapter}: <title>\`.`,
    "Do not reprint the title page, the contents, or any earlier chapter — they are",
    "already in the document and your reply is appended to it.",
    `Do not begin chapter ${chapter + 1}.`,
    planned?.targetWords ? `About ${planned.targetWords.toLocaleString()} words.` : DEFAULT_WORDS,
    "",
    SHARED_RULES,
    "",
    MANUSCRIPT_RULES,
    profileRules(input.project.formatProfile),
    "",
    isLast
      ? "This is the final chapter: land the book properly rather than trailing off."
      : `Stop at the end of chapter ${chapter}.`,
    buildMemoryReportInstruction(),
  )

  return lines.filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n")
}

/**
 * Try again, naming what was wrong.
 *
 * A generic "that failed, do it again" gets the same response back, because the
 * model has no idea which part was rejected. Each rejection therefore carries
 * its own correction, and the base request is repeated so the retry is not
 * relying on the failed attempt still being in context.
 */
export function buildRepairPrompt(input: {
  project: BookProject
  manuscript: string
  chapter: number
  rejection: ChapterRejection
}): string {
  const correction = repairCorrection(input.rejection, input.chapter)

  return [
    `[RETRY — CHAPTER ${input.chapter}]`,
    `Your previous attempt was rejected: ${input.rejection.detail}`,
    correction,
    "",
    buildChapterPrompt(input),
  ].join("\n")
}

/** The habits that differ between kinds of book. */
function profileRules(profile: BookProject["formatProfile"]): string {
  switch (profile) {
    case "fiction":
      return [
        "- Continuous prose. Do not use subheadings inside the chapter; a novel",
        "  does not have them, and the reader is not skimming.",
      ].join("\n")
    case "textbook":
      return [
        "- Sections are allowed: use ### for a subheading where the material",
        "  genuinely divides. Examples, definitions and short lists are fine.",
      ].join("\n")
    case "nonfiction":
      return [
        "- A ### subheading is allowed where the argument genuinely turns, but",
        "  not every few paragraphs — prose carries the chapter, not headings.",
      ].join("\n")
  }
}

function repairCorrection(rejection: ChapterRejection, chapter: number): string {
  switch (rejection.code) {
    case "extra-chapters":
      return `Write chapter ${chapter} ONLY. Stop at its last sentence — do not write a heading for any other chapter.`
    case "reprinted-front-matter":
      return "The title page, the contents and every earlier chapter are already in the document. Begin at the chapter heading and write nothing before it."
    case "wrong-chapter":
      return `The first line must be exactly \`## Chapter ${chapter}: <title>\`.`
    case "too-short":
      return "That was a summary. Write the chapter itself, at full length, in scenes and paragraphs."
    case "outline-not-prose":
      return "Do not describe what the chapter will cover. Write the chapter."
    case "empty":
      return "The response was empty. Write the chapter."
  }
}

/** Chapters the plan lists that are not yet written, for the progress card. */
export function upcomingChapters(project: BookProject): BookChapter[] {
  return project.chapters.filter((c) => c.number > project.written)
}
