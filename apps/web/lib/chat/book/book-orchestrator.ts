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
  hasBookControlTags,
  parseBookOutline,
  parseBookTitle,
  stripBookControlTags,
} from "./book-parser"
import { inferFormatProfile } from "./book-document"
import { applyChapterToMemory, parseMemoryReport, truncateMemory } from "./book-memory"
import { buildChapterPrompt, buildRepairPrompt } from "./book-prompts"
import { bookRepository, NEW_CHAT_KEY } from "./book-storage"
import { validateChapter, type ChapterRejection } from "./book-validator"
import {
  bookIsComplete,
  emptyBookMemory,
  isBookRunnable,
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

/**
 * Where a chapter is in its own life.
 *
 * Reported rather than guessed. "Thinking" is the real silence before the first
 * token, "validating" is the real gap between the stream ending and the chapter
 * being accepted — a progress indicator that invented these would be describing
 * a timeline instead of a run.
 */
export type BookRunPhase = "thinking" | "writing" | "validating" | "saving"

type BookRunState = {
  project: BookProject | null
  /** The full document. The source of truth for what has been written. */
  manuscript: string
  /** The chapter in flight, as it streams. Never merged until it validates. */
  streamingText: string
  streamingChapter: number | null
  /** What the chapter in flight is doing. Null when nothing is in flight. */
  phase: BookRunPhase | null
  /** Set while a generation is running; also the value of the lock. */
  operationId: string | null
  lastRejection: ChapterRejection | null
  /**
   * The opening turn, before there is a project to show.
   *
   * `/book` spends its first call producing the title, the outline and chapter
   * one, and only then is there a `BookProject`. Without this the work is
   * invisible for the longest single call of the whole book — which is exactly
   * the moment a reader who has left Chat most needs to be told it is running.
   */
  planning: { conversationId: string | null; brief: string } | null
}

type BookRunActions = {
  setGenerator: (generator: ChapterGenerator | null) => void
  /** Wire the server sync. Null keeps the orchestrator entirely local. */
  setRunSync: (sync: BookRunSync | null) => void
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

  /**
   * Adopt the server's view of a run this browser has not been executing.
   *
   * What makes a second computer useful rather than dangerous. Without it the
   * local store is empty, the progress card is absent, and the next tick reads
   * "no chapters written" and starts chapter one again.
   *
   * `executedElsewhere` is carried onto the project as a non-writing status, so
   * every existing guard — which already refuses to generate unless the status
   * is "writing" — keeps this session an observer without a second mechanism.
   */
  hydrateFromServer: (
    conversationId: string,
    run: {
      title: string
      status: string
      totalChapters: number
      writtenChapters: number
      currentChapter: number
      manuscript?: string
      error: string | null
      isExecutor: boolean
      executedElsewhere: boolean
    },
  ) => void

  /** The opening `/book` turn has been sent. Cleared by `startFromPlan`. */
  beginPlanning: (input: { conversationId: string | null; brief: string }) => void
  /** The opening turn ended without a plan — failed, or cancelled. */
  endPlanning: () => void
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
/**
 * Every state change and every refusal to schedule, in development.
 *
 * A run that stops has to say why. Three of the guards below return without
 * doing anything, and a silent return is indistinguishable from a run that
 * finished — which is exactly the position this feature was in when a real book
 * stopped after chapter one and left no evidence anywhere.
 */
/**
 * Turn the trace on in a production build.
 *
 * The gate below silences the log outside development, which is right for a
 * reader's console and wrong the moment a real book stops on a real install —
 * the one place the trace is actually needed is the one place it did not
 * exist. `localStorage.setItem("arciin:book-debug", "1")` opts in, per browser,
 * and nothing is printed for anyone who has not asked.
 */
export const BOOK_DEBUG_KEY = "arciin:book-debug"

function debugEnabled(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(BOOK_DEBUG_KEY) === "1"
  } catch {
    return false
  }
}

function log(event: string, detail: Record<string, unknown> = {}) {
  if (process.env.NODE_ENV === "production" && !debugEnabled()) return
  const parts = Object.entries(detail).map(([k, v]) => `${k}=${String(v)}`)
  console.info(`[book] ${event}${parts.length ? ` ${parts.join(" ")}` : ""}`)
}

/**
 * True once this session has adopted a plan and started writing.
 *
 * The distinction that matters: a project loaded from storage after a page load
 * may describe an attempt that never finished, so it is recovered as paused. A
 * project this session is actively running is a different thing entirely, and
 * demoting it because a component re-attached is not recovery — it is stopping
 * the book.
 */
let liveRunConversationId: string | null = null

/**
 * How the run is published to the server.
 *
 * Injected rather than imported for the same reason the generator is: the
 * orchestration rules must stay verifiable with a stub and no HTTP. It is also
 * what makes cross-device single-flight enforceable here — `publish` answers
 * whether this session actually owns generation.
 */
export type BookRunSync = {
  publish: (input: {
    conversationId: string
    status: string
    title?: string
    totalChapters?: number
    writtenChapters?: number
    currentChapter?: number
    currentChapterTitle?: string | null
    manuscript?: string
    error?: string | null
  }) => Promise<{ executedElsewhere: boolean } | null>
  heartbeat: (conversationId: string) => Promise<void>
}

let runSync: BookRunSync | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null

/** Refreshed on a timer while a chapter streams — never per token. */
const HEARTBEAT_MS = 15_000

function startHeartbeat(conversationId: string) {
  stopHeartbeat()
  if (!runSync || conversationId === NEW_CHAT_KEY) return
  heartbeatTimer = setInterval(() => {
    void runSync?.heartbeat(conversationId).catch(() => {})
  }, HEARTBEAT_MS)
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

/** Fire-and-forget status publish. A sync failure must never stop a book. */
function publish(input: Parameters<BookRunSync["publish"]>[0]) {
  if (!runSync || !input.conversationId || input.conversationId === NEW_CHAT_KEY) return
  void runSync.publish(input).catch(() => {})
}

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
  // The manuscript travels with the project from here on, so every persist
  // writes the document too — that is what lets a chapter land while the
  // Canvas is unmounted and still be there when it comes back.
  const outline = parseBookOutline(manuscript)
  // The plan only grows: a manuscript whose contents block has scrolled out of
  // a partial parse must not silently shrink the book to the chapters written.
  const chapters = outline.length >= project.chapters.length ? outline : project.chapters
  const written = countChaptersWritten(manuscript)

  return {
    ...project,
    manuscript,
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
  phase: null,
  operationId: null,
  lastRejection: null,
  planning: null,

  hydrateFromServer: (conversationId, run) => {
    const current = get().project

    // This session is the executor and already has the run in memory. The
    // server is echoing our own writes; adopting them would fight the local
    // state mid-chapter.
    if (run.isExecutor && current?.conversationId === conversationId) return
    if (inFlight && current?.conversationId === conversationId) return

    const manuscript = stripBookControlTags(run.manuscript ?? "")
    // The document decides, as always: trust its headings over the counter.
    const written = countChaptersWritten(manuscript)
    const outline = parseBookOutline(manuscript)

    /**
     * An observer never gets a status that authorises generation.
     *
     * "writing" is the only status any tick acts on, so mapping a live remote
     * run to "stopping" makes this session watch rather than write, with no
     * extra flag for a future guard to forget.
     */
    const status: BookProjectStatus = run.executedElsewhere
      ? "stopping"
      : run.status === "COMPLETED"
        ? "completed"
        : run.status === "FAILED"
          ? "failed"
          : "paused"

    const base: BookProject = current?.conversationId === conversationId && current
      ? current
      : {
          conversationId,
          title: run.title,
          brief: "",
          chapters: [],
          status,
          currentChapter: run.currentChapter,
          written,
          autoContinue: false,
          formatProfile: inferFormatProfile(run.title),
          manuscript,
          memory: emptyBookMemory(),
          attempts: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }

    const chapters =
      outline.length > 0
        ? outline
        : base.chapters.length > 0
          ? base.chapters
          : Array.from({ length: run.totalChapters }, (_, i) => ({
              number: i + 1,
              title: `Chapter ${i + 1}`,
              summary: "",
            }))

    log("hydrated_from_server", {
      conversation: conversationId,
      status: run.status,
      observer: run.executedElsewhere,
      written,
    })

    set({
      project: persist({
        ...base,
        title: run.title || base.title,
        status,
        chapters,
        written,
        /**
         * The manuscript decides, not the server's counter.
         *
         * Taking the larger of the two would let a stale or optimistic
         * `currentChapter` skip a chapter that is genuinely missing from the
         * document — the exact rule this feature has held since the beginning.
         */
        currentChapter: written + 1,
        manuscript: manuscript || base.manuscript,
        autoContinue: false,
        lastError: run.error ?? undefined,
        updatedAt: Date.now(),
      }),
      manuscript: manuscript || base.manuscript,
    })
  },

  beginPlanning: ({ conversationId, brief }) => {
    log("planning_started", { conversation: conversationId ?? NEW_CHAT_KEY })
    set({ planning: { conversationId, brief } })
  },

  endPlanning: () => {
    if (!get().planning) return
    log("planning_ended", {})
    set({ planning: null })
  },

  setGenerator: (next) => {
    generator = next
  },

  setRunSync: (next) => {
    runSync = next
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
      manuscript: clean,
      memory: emptyBookMemory(),
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const project = syncFromManuscript(base, clean)
    // A plan with no chapters after it is a plan that failed; writing on from
    // it would produce chapters the reader never agreed to the shape of.
    const status: BookProjectStatus = project.chapters.length === 0 ? "paused" : "writing"

    liveRunConversationId = conversationId
    log("project_created", {
      chapters: project.chapters.length,
      written: project.written,
      status,
      profile: project.formatProfile,
    })

    set({
      project: persist({ ...project, status }),
      manuscript: clean,
      streamingText: "",
      streamingChapter: null,
      phase: null,
      // There is a project now, so the placeholder has done its job.
      planning: null,
      lastRejection: null,
    })
    publish({
      conversationId,
      status: status === "writing" ? "THINKING" : "PAUSED",
      title: project.title,
      totalChapters: project.chapters.length,
      writtenChapters: project.written,
      currentChapter: project.written + 1,
      manuscript: clean,
    })
    get().tick()
  },

  attach: (conversationId, manuscript) => {
    const stored = bookRepository().load(conversationId)
    if (!stored) {
      /**
       * "No project for this conversation" is not "no project".
       *
       * Chat mounts with `conversationId` still null and learns the real id a
       * beat later — from a `?c=` deep link, from a history click, or from the
       * conversation row being created mid-book. That first, provisional
       * attach used to clear the store, and the store is global: it took the
       * running book with it. The next tick found `no_project` and the run
       * stopped silently, and worse, a chapter that landed inside that window
       * would have been appended to an empty `manuscript` — every previous
       * chapter gone, from a route change.
       *
       * A run that is actually going is therefore never torn down here. Only
       * `detach` ends a book.
       */
      const current = get().project
      if (current && (isBookRunnable(current) || inFlight !== null)) {
        /**
         * The chat has just been given its real id, and this is the moment to
         * take it.
         *
         * A book begun on a fresh chat is created before the conversation row
         * exists, so it is parked under `__new__`. Chat calls
         * `bookRepository().rekey()` once the first exchange is saved — but
         * that happens *after* `setConversationId`, so this attach runs first
         * and finds nothing stored under the new id. Leaving the run on the
         * placeholder key then costs two things: the AI Tasks entry has no
         * conversation to open (its row is disabled), and every later persist
         * writes back to `__new__` while the row the reader's URL points at
         * goes stale — so a reload would restore a manuscript missing every
         * chapter written after this instant.
         */
        if (conversationId && current.conversationId === NEW_CHAT_KEY) {
          bookRepository().remove(NEW_CHAT_KEY)
          liveRunConversationId = conversationId
          const moved = { ...current, conversationId }
          log("attach_adopted_conversation", {
            to: conversationId,
            written: moved.written,
            status: moved.status,
          })
          set({ project: persist(moved) })
          return
        }
        log("attach_ignored_live_run", {
          conversation: conversationId ?? "none",
          status: current.status,
        })
        return
      }
      set({ project: null, manuscript: "", streamingText: "", streamingChapter: null, phase: null })
      return
    }

    // Prefer what was persisted: chapters written while Chat was unmounted are
    // in the stored manuscript and not in anything the caller can pass.
    const incoming = stripBookControlTags(manuscript || "")
    const stored_ms = stripBookControlTags(stored.manuscript || "")
    const clean = stored_ms.length >= incoming.length ? stored_ms : incoming
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
    /**
     * A run this session started is still running. `attach` fires whenever the
     * conversation id changes — including the moment a brand-new chat receives
     * its real id, seconds after `/book` handed the plan over — so treating
     * every attach as a page reload paused the book on its very first turn,
     * between chapters, with nothing on screen to say why.
     */
    const isLiveRun =
      liveRunConversationId !== null &&
      (liveRunConversationId === conversationId ||
        liveRunConversationId === NEW_CHAT_KEY ||
        stored.conversationId === liveRunConversationId)

    if (isLiveRun) {
      liveRunConversationId = conversationId ?? liveRunConversationId
      log("attach_live_run_preserved", {
        conversation: conversationId,
        status: synced.status,
        written: synced.written,
      })
      set({ project: persist(synced), manuscript: clean })
      // The scheduler may have been waiting on a project keyed to the old id.
      get().tick()
      return
    }

    const recovered: BookProjectStatus =
      synced.status === "writing" || synced.status === "stopping"
        ? "paused"
        : bookIsComplete(synced) && synced.chapters.length > 0
          ? "completed"
          : synced.status
    log("attach_recovered", { from: synced.status, to: recovered, written: synced.written })

    set({
      project: persist({
        ...synced,
        status: recovered,
        autoContinue: recovered === "paused" ? false : synced.autoContinue,
      }),
      manuscript: clean,
      streamingText: "",
      streamingChapter: null,
      phase: null,
      lastRejection: null,
    })
  },

  detach: () => {
    // Only an explicit teardown cancels. A component unmounting must never mean
    // "cancel my book" — see the limitation noted in the report.
    abortController?.abort()
    abortController = null
    inFlight = null
    liveRunConversationId = null
    set({
      project: null,
      manuscript: "",
      streamingText: "",
      streamingChapter: null,
      phase: null,
      operationId: null,
      planning: null,
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
    if (!inFlight) {
      stopHeartbeat()
      publish({
        conversationId: project.conversationId,
        status: "PAUSED",
        writtenChapters: project.written,
        currentChapter: project.written + 1,
      })
    }
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
  if (inFlight) {
    log("next_schedule_blocked", { reason: "already_generating", operation: inFlight })
    return
  }

  const project = get().project
  if (!project) {
    log("next_schedule_blocked", { reason: "no_project" })
    return
  }
  if (!generator) {
    // The one failure with no visible symptom at all: the run simply stops and
    // the card keeps whatever it last showed.
    log("next_schedule_blocked", { reason: "generator_unavailable" })
    return
  }

  // 2. Only an authorised state generates. "stopping" finishes what is running
  //    (which is nothing, or we would have returned at the lock) and stops.
  if (project.status !== "writing") {
    log("next_schedule_blocked", { reason: "status", status: project.status })
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
      phase: null,
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

  /**
   * Claim generation before spending anything.
   *
   * This is the cross-device single-flight point. Another computer signed into
   * the same account will reach here with its own view of the manuscript and
   * conclude the same chapter is missing; the server answers which session owns
   * the run, and the one that does not becomes an observer instead of paying
   * for a duplicate chapter.
   */
  if (runSync && project.conversationId && project.conversationId !== NEW_CHAT_KEY) {
    let claim: { executedElsewhere: boolean } | null = null
    try {
      claim = await runSync.publish({
        conversationId: project.conversationId,
        status: "THINKING",
        title: project.title,
        totalChapters: project.chapters.length,
        writtenChapters: project.written,
        currentChapter: chapter,
        currentChapterTitle:
          project.chapters.find((c) => c.number === chapter)?.title ?? null,
      })
    } catch {
      // The server is unreachable. Carrying on locally is the lesser risk: the
      // alternative is stalling a book because a status write failed.
      claim = null
    }
    if (claim?.executedElsewhere) {
      log("next_schedule_blocked", { reason: "executed_elsewhere", chapter })
      return
    }
  }

  const operationId = newOperationId()
  inFlight = operationId
  abortController = new AbortController()
  startHeartbeat(project.conversationId)

  log("generation_started", { chapter, operation: operationId, attempt: project.attempts + 1 })
  set({
    operationId,
    streamingChapter: chapter,
    streamingText: "",
    // Nothing has come back yet. This is the long silence, and saying so beats
    // showing "writing" over an empty buffer.
    phase: "thinking",
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
        set({ streamingText: fullText, phase: fullText ? "writing" : "thinking" })
      },
    })

    if (inFlight !== operationId) return

    if (!result.ok) {
      finishAttempt(set, get, { operationId, error: result.error })
      return
    }

    // Memory is read from the raw response; validation and everything
    // downstream see only prose. The order matters — validating the raw text
    // let control tags into the word count and, worse, into the manuscript.
    set({ phase: "validating" })
    const cleaned = stripBookControlTags(result.raw)
    const report = parseMemoryReport(result.raw)
    log("metadata_extracted", {
      chapter,
      summary: Boolean(report.summary),
      carry: report.carries.length,
      threads: report.opened.length + report.resolved.length,
      leaked: hasBookControlTags(cleaned),
    })

    const validation = validateChapter({
      raw: cleaned,
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
    set({ phase: "saving" })
    const current = get()
    // Stripped once more at the boundary. Cheap, and the only place that can
    // guarantee the stored manuscript is clean whatever a future tag does.
    const chapterProse = stripBookControlTags(validation.text).trim()
    const appended = `${current.manuscript.trimEnd()}\n\n${chapterProse}`
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
      text: chapterProse,
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

    log("chapter_appended", { chapter, words: validation.words, status: nextStatus })
    stopHeartbeat()
    publish({
      conversationId: synced.conversationId,
      status: done ? "COMPLETED" : stopping ? "PAUSED" : "THINKING",
      title: synced.title,
      totalChapters: synced.chapters.length,
      writtenChapters: synced.written,
      currentChapter: synced.written + 1,
      currentChapterTitle:
        synced.chapters.find((c) => c.number === synced.written + 1)?.title ?? null,
      // The manuscript travels with the status, so another computer opening
      // the conversation reads the chapters already written.
      manuscript: appended,
      error: null,
    })
    set({
      manuscript: appended,
      project: persist({
        ...synced,
        status: nextStatus,
        autoContinue: nextStatus === "writing",
      }),
      streamingText: "",
      streamingChapter: null,
      phase: null,
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
    log("next_scheduled", { chapter: get().project!.written + 1 })
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

  log("generation_failed", { chapter: project.written + 1, attempt: attempts, reason: input.error })
  if (exhausted) {
    stopHeartbeat()
    publish({
      conversationId: project.conversationId,
      status: "FAILED",
      writtenChapters: project.written,
      currentChapter: project.written + 1,
      error: input.error,
    })
  }
  set({
    project: persist({
      ...project,
      attempts,
      status: exhausted ? "failed" : project.status === "stopping" ? "paused" : "writing",
      lastError: input.error,
    }),
    streamingText: "",
    streamingChapter: null,
    phase: null,
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
  stopHeartbeat()
  runSync = null
  liveRunConversationId = null
  inFlight = null
  abortController = null
  generator = null
  onManuscriptChange = null
}
