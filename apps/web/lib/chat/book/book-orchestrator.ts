/**
 * The thing that actually writes the book.
 *
 * One chapter is still one model call — that limit has not moved. What changed
 * is who presses continue. This owns the loop, so a reader assigns the book once
 * and walks away.
 *
 * The design constraint that shapes everything here: **a chapter must never be
 * generated twice**. React runs effects twice in development, streams retry,
 * tabs get reopened, and a reader can click Resume while a chapter is already in
 * flight. Any of those firing the scheduler must be harmless. Three things make
 * that true:
 *
 * 1. A module-level lock, taken synchronously before the first `await`. Two
 *    callers in the same tick cannot both pass it.
 * 2. `status` authorises work. Nothing runs unless it is "writing", and pause,
 *    completion and failure all leave a status that no scheduler tick acts on.
 * 3. The manuscript is re-parsed after every append. A chapter that is already
 *    in the document cannot be "next", however confused the caller is.
 *
 * Deliberately not a `while` loop in a component: the run outlives any render,
 * and the UI observes it rather than driving it.
 */

import { create } from "zustand"

import {
  countChaptersWritten,
  parseBookOutline,
  parseBookTitle,
  stripBookControlTags,
} from "./book-parser"
import { inferFormatProfile } from "./book-document"
import { applyChapterToMemory, truncateMemory } from "./book-memory"
import { buildChapterPrompt, buildRepairPrompt } from "./book-prompts"
import { bookRepository } from "./book-storage"
import { validateChapter, type ChapterRejection } from "./book-validator"
import {
  bookIsComplete,
  emptyBookMemory,
  type BookProject,
  type BookProjectStatus,
} from "./types"

/** Repair attempts per chapter before the project is marked failed. */
export const MAX_CHAPTER_ATTEMPTS = 3

export type GenerateChapterRequest = {
  prompt: string
  chapter: number
  operationId: string
  onToken: (fullText: string) => void
  signal: AbortSignal
}

export type GenerateChapterResult =
  | { ok: true; raw: string }
  | { ok: false; error: string }

/**
 * How a chapter gets written.
 *
 * Injected rather than imported so the orchestrator can be driven by a stub in
 * tests — every rule above is verifiable without spending a token.
 */
export type ChapterGenerator = (
  request: GenerateChapterRequest,
) => Promise<GenerateChapterResult>

type BookRunState = {
  project: BookProject | null
  /** The full document. The source of truth for what has been written. */
  manuscript: string
  /** The chapter in flight, as it streams. Never merged until it validates. */
  streamingText: string
  streamingChapter: number | null
  /** Set while a generation is running; also the value of the lock. */
  operationId: string | null
  lastRejection: ChapterRejection | null
}

type BookRunActions = {
  setGenerator: (generator: ChapterGenerator | null) => void
  /** Called when the manuscript changes so the Canvas can mirror it. */
  setOnManuscriptChange: (fn: ((manuscript: string, title: string) => void) | null) => void

  /** Adopt the plan turn's output and begin automatic writing. */
  startFromPlan: (input: {
    conversationId: string
    brief: string
    manuscript: string
  }) => void

  /** Load a project for a conversation, recovering a crashed run as paused. */
  attach: (conversationId: string | null, manuscript: string) => void
  detach: () => void

  pause: () => void
  stopAfterCurrent: () => void
  resume: () => void
  retryCurrent: () => void

  /** Re-derive progress from the document — after a manual edit, or on resume. */
  resync: (manuscript: string) => void

  /** Ask the scheduler to consider starting the next chapter. Idempotent. */
  tick: () => void
}

export type BookRunStore = BookRunState & BookRunActions

/**
 * The lock.
 *
 * Module scope, not store state: a Zustand `set` is asynchronous with respect to
 * React rendering, so two ticks in one frame could both read `operationId` as
 * null and both start. A plain variable is checked and written in the same
 * synchronous step, which is the only thing that actually excludes.
 */
let inFlight: string | null = null
let abortController: AbortController | null = null
let generator: ChapterGenerator | null = null
let onManuscriptChange: ((manuscript: string, title: string) => void) | null = null

function newOperationId(): string {
  return `book-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Fold a manuscript into a project.
 *
 * Every field that could drift is recomputed here, so there is one place that
 * decides what the document means. `written` is the length of the unbroken run
 * from chapter one, so deleting chapter six makes six next again rather than
 * leaving a hole.
 */
function syncFromManuscript(project: BookProject, manuscript: string): BookProject {
  const outline = parseBookOutline(manuscript)
  // The plan only grows: a manuscript whose contents block has scrolled out of
  // a partial parse must not silently shrink the book to the chapters written.
  const chapters = outline.length >= project.chapters.length ? outline : project.chapters
  const written = countChaptersWritten(manuscript)

  return {
    ...project,
    title: parseBookTitle(manuscript, project.title),
    chapters,
    written,
    currentChapter: written + 1,
    memory: written < project.written ? truncateMemory(project.memory, written) : project.memory,
    updatedAt: Date.now(),
  }
}

function persist(project: BookProject): BookProject {
  bookRepository().save(project)
  return project
}

export const useBookRun = create<BookRunStore>((set, get) => ({
  project: null,
  manuscript: "",
  streamingText: "",
  streamingChapter: null,
  operationId: null,
  lastRejection: null,

  setGenerator: (next) => {
    generator = next
  },

  setOnManuscriptChange: (fn) => {
    onManuscriptChange = fn
  },

  startFromPlan: ({ conversationId, brief, manuscript }) => {
    const clean = stripBookControlTags(manuscript)
    const base: BookProject = {
      conversationId,
      title: parseBookTitle(clean, "Untitled book"),
      brief,
      chapters: [],
      status: "writing",
      currentChapter: 1,
      written: 0,
      autoContinue: true,
      // Decided once, from the brief, so chapter twelve is set like chapter one.
      formatProfile: inferFormatProfile(brief),
      memory: emptyBookMemory(),
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const project = syncFromManuscript(base, clean)
    // A plan with no chapters after it is a plan that failed; writing on from
    // it would produce chapters the reader never agreed to the shape of.
    const status: BookProjectStatus = project.chapters.length === 0 ? "paused" : "writing"

    set({
      project: persist({ ...project, status }),
      manuscript: clean,
      streamingText: "",
      streamingChapter: null,
      lastRejection: null,
    })
    get().tick()
  },

  attach: (conversationId, manuscript) => {
    const stored = bookRepository().load(conversationId)
    if (!stored) {
      set({ project: null, manuscript: "", streamingText: "", streamingChapter: null })
      return
    }

    const clean = stripBookControlTags(manuscript || "")
    const synced = syncFromManuscript(
      { ...stored, formatProfile: stored.formatProfile ?? inferFormatProfile(stored.brief) },
      clean,
    )

    /**
     * A run that was "writing" when the page went away did not finish — the tab
     * closed, the browser refreshed, the network dropped. It comes back paused
     * rather than resuming, because resuming automatically after a crash is
     * exactly how a chapter gets written twice: the interrupted attempt may
     * have completed server-side and simply not been appended here.
     */
    const recovered: BookProjectStatus =
      synced.status === "writing" || synced.status === "stopping"
        ? "paused"
        : bookIsComplete(synced) && synced.chapters.length > 0
          ? "completed"
          : synced.status

    set({
      project: persist({
        ...synced,
        status: recovered,
        autoContinue: recovered === "paused" ? false : synced.autoContinue,
      }),
      manuscript: clean,
      streamingText: "",
      streamingChapter: null,
      lastRejection: null,
    })
  },

  detach: () => {
    abortController?.abort()
    abortController = null
    inFlight = null
    set({
      project: null,
      manuscript: "",
      streamingText: "",
      streamingChapter: null,
      operationId: null,
    })
  },

  pause: () => {
    const project = get().project
    if (!project) return
    // The chapter in flight is left to finish and append: killing it mid-stream
    // throws away a chapter the reader already paid for. `stopping` is what a
    // true cancel would set; pause simply stops the *next* one starting.
    const status: BookProjectStatus = inFlight ? "stopping" : "paused"
    set({ project: persist({ ...project, status, autoContinue: false }) })
  },

  stopAfterCurrent: () => {
    const project = get().project
    if (!project) return
    set({ project: persist({ ...project, status: "stopping", autoContinue: false }) })
  },

  resume: () => {
    const project = get().project
    if (!project) return
    if (bookIsComplete(project)) {
      set({ project: persist({ ...project, status: "completed" }) })
      return
    }
    set({
      project: persist({
        ...project,
        status: "writing",
        autoContinue: true,
        attempts: 0,
        lastError: undefined,
      }),
      lastRejection: null,
    })
    get().tick()
  },

  retryCurrent: () => {
    const project = get().project
    if (!project) return
    set({
      project: persist({ ...project, status: "writing", attempts: 0, lastError: undefined }),
      lastRejection: null,
    })
    get().tick()
  },

  resync: (manuscript) => {
    const project = get().project
    if (!project) return
    const clean = stripBookControlTags(manuscript)
    set({ project: persist(syncFromManuscript(project, clean)), manuscript: clean })
  },

  tick: () => {
    void runNextChapter(set, get)
  },
}))

/**
 * Start the next chapter, if one is due and nothing is running.
 *
 * Every early return here is a guard that has to hold for the "no duplicate
 * chapters" promise, so they are listed rather than combined — a single
 * compound condition would be shorter and much harder to be sure of.
 */
async function runNextChapter(
  set: (partial: Partial<BookRunState>) => void,
  get: () => BookRunStore,
): Promise<void> {
  // 1. The lock. Synchronous, before any await, so two callers in one tick
  //    cannot both get past it.
  if (inFlight) return

  const project = get().project
  if (!project) return
  if (!generator) return

  // 2. Only an authorised state generates. "stopping" finishes what is running
  //    (which is nothing, or we would have returned at the lock) and stops.
  if (project.status !== "writing") {
    if (project.status === "stopping") {
      set({ project: persist({ ...project, status: "paused", autoContinue: false }) })
    }
    return
  }

  // 3. Nothing to do. Completion is decided by the plan, not by a counter.
  if (bookIsComplete(project)) {
    set({
      project: persist({ ...project, status: "completed", autoContinue: false }),
      streamingChapter: null,
      streamingText: "",
    })
    return
  }

  if (project.attempts >= MAX_CHAPTER_ATTEMPTS) {
    set({
      project: persist({
        ...project,
        status: "failed",
        lastError: project.lastError ?? "The chapter could not be written.",
      }),
    })
    return
  }

  const manuscript = get().manuscript
  const chapter = countChaptersWritten(manuscript) + 1

  // 4. The document decides. If this chapter is already in the manuscript, the
  //    caller is working from stale state and there is nothing to write.
  if (chapter <= project.written && project.written > 0) {
    set({ project: persist(syncFromManuscript(project, manuscript)) })
    return
  }

  const operationId = newOperationId()
  inFlight = operationId
  abortController = new AbortController()

  set({
    operationId,
    streamingChapter: chapter,
    streamingText: "",
    lastRejection: null,
  })

  try {
    const rejection = get().lastRejection
    const prompt =
      project.attempts > 0 && rejection
        ? buildRepairPrompt({ project, manuscript, chapter, rejection })
        : buildChapterPrompt({ project, manuscript, chapter })

    const result = await generator({
      prompt,
      chapter,
      operationId,
      signal: abortController.signal,
      onToken: (fullText) => {
        // A stale stream must not paint over a newer one.
        if (inFlight !== operationId) return
        set({ streamingText: fullText })
      },
    })

    if (inFlight !== operationId) return

    if (!result.ok) {
      finishAttempt(set, get, { operationId, error: result.error })
      return
    }

    const validation = validateChapter({
      raw: stripBookControlTags(result.raw),
      expected: chapter,
      targetWords: project.chapters.find((c) => c.number === chapter)?.targetWords,
    })

    if (!validation.ok) {
      finishAttempt(set, get, {
        operationId,
        error: validation.rejection.detail,
        rejection: validation.rejection,
      })
      return
    }

    // 5. Append, then re-parse. The chapter is only "written" once the document
    //    says so — that read-back is what makes the next tick's decision safe.
    const current = get()
    const appended = `${current.manuscript.trimEnd()}\n\n${validation.text.trim()}`
    const reparsed = countChaptersWritten(appended)

    if (reparsed !== chapter) {
      // The heading did not survive the append as its own chapter. Treated as a
      // failed attempt rather than accepted, or the run would advance past a
      // chapter the document does not contain.
      finishAttempt(set, get, {
        operationId,
        error: `Chapter ${chapter} did not parse back out of the manuscript.`,
        rejection: {
          code: "wrong-chapter",
          detail: `Expected chapter ${chapter} in the document after appending.`,
          found: [],
        },
      })
      return
    }

    const withMemory = applyChapterToMemory({
      memory: current.project?.memory ?? emptyBookMemory(),
      chapter,
      title: current.project?.chapters.find((c) => c.number === chapter)?.title ?? `Chapter ${chapter}`,
      text: validation.text,
      raw: result.raw,
    })

    const base = current.project ?? project
    const synced = syncFromManuscript(
      { ...base, memory: withMemory, attempts: 0, lastError: undefined },
      appended,
    )

    const done = bookIsComplete(synced)
    const stopping = base.status === "stopping"
    const nextStatus: BookProjectStatus = done ? "completed" : stopping ? "paused" : "writing"

    set({
      manuscript: appended,
      project: persist({
        ...synced,
        status: nextStatus,
        autoContinue: nextStatus === "writing",
      }),
      streamingText: "",
      streamingChapter: null,
      operationId: null,
      lastRejection: null,
    })
    onManuscriptChange?.(appended, synced.title)
  } catch (error) {
    if (inFlight === operationId) {
      finishAttempt(set, get, {
        operationId,
        error: error instanceof Error ? error.message : "The chapter could not be written.",
      })
      return
    }
  } finally {
    if (inFlight === operationId) {
      inFlight = null
      abortController = null
    }
  }

  // 6. Release before scheduling, so the next call finds the lock free. Queued
  //    as a task rather than recursing, to keep the stack flat over 40 chapters
  //    and to leave a gap for a pause to land between them.
  if (inFlight === null && get().project?.status === "writing") {
    scheduleTick(get)
  }
}

/** Record a failed attempt and either retry or give up. */
function finishAttempt(
  set: (partial: Partial<BookRunState>) => void,
  get: () => BookRunStore,
  input: { operationId: string; error: string; rejection?: ChapterRejection },
) {
  if (inFlight !== input.operationId) return
  inFlight = null
  abortController = null

  const project = get().project
  if (!project) return

  const attempts = project.attempts + 1
  const exhausted = attempts >= MAX_CHAPTER_ATTEMPTS

  set({
    project: persist({
      ...project,
      attempts,
      status: exhausted ? "failed" : project.status === "stopping" ? "paused" : "writing",
      lastError: input.error,
    }),
    streamingText: "",
    streamingChapter: null,
    operationId: null,
    lastRejection: input.rejection ?? null,
  })

  if (!exhausted && get().project?.status === "writing") {
    scheduleTick(get)
  }
}

/**
 * Hand control back before the next chapter.
 *
 * A macrotask, not a microtask: it lets React paint the chapter that just
 * landed and gives a Pause click somewhere to land between chapters, which is
 * the whole reason pausing feels immediate even though a chapter is atomic.
 */
function scheduleTick(get: () => BookRunStore) {
  setTimeout(() => {
    get().tick()
  }, 0)
}

/** Test seam: clear the module-level lock between cases. */
export function __resetBookOrchestratorForTests() {
  inFlight = null
  abortController = null
  generator = null
  onManuscriptChange = null
}
