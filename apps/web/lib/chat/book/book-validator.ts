/**
 * Checking a chapter before it becomes part of the book.
 *
 * Automatic continuation is only safe if the thing being appended is actually
 * the chapter that was asked for. Without this, one bad response propagates:
 * a reply that reprints the title page puts a second title page in the middle
 * of the manuscript, and the next chapter's prompt then reads that as the tail
 * and carries on from it.
 *
 * So every response is checked, and a failure produces a typed reason that the
 * repair prompt turns into a specific instruction — "you included chapter 8"
 * repairs; "that was not good enough" does not.
 *
 * Pure, and the single place that decides whether a chapter is acceptable.
 */

import {
  countWords,
  extractChapter,
  writtenChapterNumbers,
} from "./book-parser"

export type ChapterRejection =
  | { code: "empty"; detail: string }
  | { code: "wrong-chapter"; detail: string; found: number[] }
  | { code: "extra-chapters"; detail: string; found: number[] }
  | { code: "reprinted-front-matter"; detail: string }
  | { code: "too-short"; detail: string; words: number; expected: number }
  | { code: "outline-not-prose"; detail: string }

export type ChapterValidation =
  | { ok: true; text: string; words: number }
  | { ok: false; rejection: ChapterRejection }

/**
 * Below this, a "chapter" is a summary of one.
 *
 * Held well under the 1,200-word target on purpose. The check exists to catch
 * a model that wrote an outline instead of prose, not to enforce the target —
 * rejecting an honest 900-word chapter would spend a second call to get a
 * chapter no better than the one thrown away.
 */
const MIN_CHAPTER_WORDS = 450

/** Phrases that introduce a plan for a chapter rather than the chapter. */
const OUTLINE_TELLS =
  /\b(?:in this chapter,? (?:we|i) (?:will|shall)|this chapter will (?:cover|explore|discuss)|here'?s? (?:an|the) outline|outline for chapter)\b/i

export function validateChapter(input: {
  raw: string
  expected: number
  /** Words the plan asked for, used only to scale the "too short" message. */
  targetWords?: number
}): ChapterValidation {
  const text = input.raw.trim()
  if (!text) {
    return { ok: false, rejection: { code: "empty", detail: "The response was empty." } }
  }

  const found = writtenChapterNumbers(text)

  if (found.length === 0) {
    return {
      ok: false,
      rejection: {
        code: "wrong-chapter",
        detail: `No chapter heading. Expected "## Chapter ${input.expected}: <title>".`,
        found,
      },
    }
  }

  if (!found.includes(input.expected)) {
    return {
      ok: false,
      rejection: {
        code: "wrong-chapter",
        detail: `Expected chapter ${input.expected}, got ${found.join(", ")}.`,
        found,
      },
    }
  }

  // Front matter reprinted mid-book. Checked before the extra-chapter rule so
  // a response that both reprints the opening and runs on reports the cause
  // the reader would recognise.
  const reprintsFrontMatter =
    /^#{1,3}\s*(?:table\s+of\s+)?contents\s*$/im.test(text) ||
    (input.expected > 1 && found.includes(1))
  if (reprintsFrontMatter) {
    return {
      ok: false,
      rejection: {
        code: "reprinted-front-matter",
        detail: "The response reprinted the contents or an earlier chapter.",
      },
    }
  }

  const extra = found.filter((n) => n !== input.expected)
  if (extra.length > 0) {
    return {
      ok: false,
      rejection: {
        code: "extra-chapters",
        detail: `The response ran on into chapter ${extra.join(", ")}.`,
        found: extra,
      },
    }
  }

  // Take the chapter itself rather than the whole reply: a model that prefaces
  // its answer would otherwise have that preface counted and appended.
  const chapter = extractChapter(text, input.expected) ?? text
  const words = countWords(chapter)

  if (OUTLINE_TELLS.test(chapter) && words < 900) {
    return {
      ok: false,
      rejection: {
        code: "outline-not-prose",
        detail: "The response describes the chapter instead of being it.",
      },
    }
  }

  if (words < MIN_CHAPTER_WORDS) {
    return {
      ok: false,
      rejection: {
        code: "too-short",
        detail: `Only ${words} words; a chapter here should be around ${
          input.targetWords ?? 1500
        }.`,
        words,
        expected: input.targetWords ?? 1500,
      },
    }
  }

  return { ok: true, text: chapter, words }
}

/** A short line naming what went wrong, for the repair prompt and the UI. */
export function describeRejection(rejection: ChapterRejection): string {
  return rejection.detail
}
