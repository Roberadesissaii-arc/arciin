/**
 * The shape of a book being written.
 *
 * Everything here is serialisable and free of React, so the orchestrator can be
 * driven by a test with a stub generator and no browser.
 *
 * Two invariants run through the whole feature and are worth stating once:
 *
 * 1. The manuscript is the source of truth for what has been written. `written`
 *    and `currentChapter` are derived by parsing it, never incremented. A reader
 *    who deletes chapter six by hand gets chapter six rewritten, not skipped.
 * 2. `status` is the only thing that authorises work. Nothing generates unless
 *    it is "writing" and no lock is held, which is what makes a duplicate
 *    trigger — a double effect, a retried stream, a reopened tab — harmless.
 */

/**
 * How the book is set.
 *
 * Fiction runs its paragraphs on with a first-line indent; the other two keep
 * block paragraphs, because their paragraphs are units of argument. Chosen once
 * from the brief and stored, so every chapter is set the same way.
 */
export type BookFormatProfile = "fiction" | "nonfiction" | "textbook"

export type BookProjectStatus =
  /** The opening turn is producing the title, outline and chapter one. */
  | "planning"
  /** Chapters are being generated automatically. */
  | "writing"
  /** Stopped by the reader, or recovered from a reload. Resumable. */
  | "paused"
  /** Finish the chapter in flight, then pause. */
  | "stopping"
  /** Every planned chapter exists in the manuscript. */
  | "completed"
  /** Repair attempts were exhausted. Holds `lastError` and a retry action. */
  | "failed"

/**
 * A chapter's contract.
 *
 * `title` and `summary` come from the outline the model writes. The rest are
 * optional because a model does not reliably produce them for every chapter,
 * and a missing beat list must not stop the book — it only makes the prompt for
 * that chapter thinner.
 */
export type BookChapter = {
  number: number
  title: string
  /** One line on what this chapter does, from the outline. */
  summary: string
  /** Why the chapter exists in the arc, when the plan gives one. */
  purpose?: string
  /** Things that must happen in it. */
  requiredBeats?: string[]
  /** Material reserved for later chapters, which this one must not spend. */
  mustNotResolve?: string[]
  targetWords?: number
}

/* ------------------------------------------------------------------- memory */

export type ChapterSummary = {
  chapter: number
  title: string
  /** Two or three sentences — what a later chapter needs to know happened. */
  summary: string
  words: number
}

export type MemoryEntity = {
  name: string
  /** What the manuscript has established. Rewritten as chapters add to it. */
  note: string
  /** Chapter this was last touched in, so stale entries can be aged out. */
  lastSeen: number
}

export type StoryThread = {
  id: string
  description: string
  openedIn: number
  resolvedIn?: number
}

/**
 * What the book has established so far.
 *
 * Deliberately not part of the manuscript: it is working notes, and a reader
 * who exports their book should not find a continuity table in chapter twelve.
 *
 * Works for both kinds of book. Fiction fills `characters`, `locations` and
 * `threads`; non-fiction fills `facts` with claims made, examples spent and
 * terms defined, which is the same problem wearing different words — a chapter
 * must not re-argue what chapter three already argued.
 */
export type BookMemory = {
  chapterSummaries: ChapterSummary[]
  characters: MemoryEntity[]
  locations: MemoryEntity[]
  /** Claims, definitions, examples already used. */
  facts: MemoryEntity[]
  threads: StoryThread[]
  /** Voice and tense decisions, so chapter nine reads like chapter one. */
  styleNotes: string[]
}

export function emptyBookMemory(): BookMemory {
  return {
    chapterSummaries: [],
    characters: [],
    locations: [],
    facts: [],
    threads: [],
    styleNotes: [],
  }
}

/* ------------------------------------------------------------------ project */

export type BookProject = {
  conversationId: string
  title: string
  /** What the reader asked for, verbatim. Sets the voice for every chapter. */
  brief: string
  chapters: BookChapter[]
  status: BookProjectStatus
  /** The chapter being written, or the one that would be written next. */
  currentChapter: number
  /** How many chapters the manuscript actually contains. Parsed, not counted. */
  written: number
  /** False after a pause; the reader restarts the run explicitly. */
  autoContinue: boolean
  formatProfile: BookFormatProfile
  /** Only ever what the reader supplied. Never invented — see book-prompts. */
  subtitle?: string
  author?: string
  memory: BookMemory
  /** Consecutive failed attempts at `currentChapter`. Reset on success. */
  attempts: number
  createdAt: number
  updatedAt: number
  lastError?: string
}

/** Chapters planned but not yet in the manuscript. */
export function remainingChapters(project: BookProject): BookChapter[] {
  return project.chapters.filter((c) => c.number > project.written)
}

export function nextChapterNumber(project: BookProject): number {
  return project.written + 1
}

export function isBookRunnable(project: BookProject | null): project is BookProject {
  if (!project) return false
  return project.status === "writing" || project.status === "stopping"
}

/** Every planned chapter exists, so there is nothing left to generate. */
export function bookIsComplete(project: BookProject): boolean {
  return project.chapters.length > 0 && project.written >= project.chapters.length
}

export function bookProgress(project: BookProject): {
  done: number
  total: number
  percent: number
} {
  const total = project.chapters.length
  const done = Math.min(project.written, total || project.written)
  return {
    done,
    total,
    // Chapters, not words: a percentage of an unknown final length is a guess
    // dressed as a measurement.
    percent: total > 0 ? Math.round((done / total) * 100) : 0,
  }
}
