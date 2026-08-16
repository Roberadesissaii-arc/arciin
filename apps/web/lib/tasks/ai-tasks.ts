/**
 * What the application shell knows about long-running AI work.
 *
 * A book is written by a module-level orchestrator, not by the Chat route, so
 * a reader can start one and go and look at their files. That freedom is only
 * usable if the shell says the work is still happening — otherwise leaving Chat
 * feels exactly like cancelling.
 *
 * This is a *view*, not a second state machine. Every field is read from the
 * book run store, so the sidebar and the Book Progress Card cannot disagree:
 * there is one run, and two things looking at it. When deep research or
 * document generation want the same treatment they add a deriver here rather
 * than a second indicator.
 */

import {
  useBookRun,
  type BookRunPhase,
} from "@/lib/chat/book/book-orchestrator"
import { NEW_CHAT_KEY } from "@/lib/chat/book/book-storage"
import { bookProgress, nextChapterNumber, type BookProject } from "@/lib/chat/book/types"

/** Whether a task is holding the shell's attention, and how. */
export type AITaskState =
  | "planning"
  | "running"
  | "paused"
  | "failed"
  | "completed"

export type AITaskView = {
  id: string
  type: "book"
  title: string
  /** A sentence for a person: "Writing Chapter 3", "Paused". */
  status: string
  state: AITaskState
  /** Chapters written. Absent while planning, when there is no plan to count. */
  current?: number
  total?: number
  /** Where clicking the task should go. Absent only before the chat has an id. */
  conversationId?: string
}

/** Tasks that count towards the badge. Completed work is not running work. */
export function isTaskRunning(task: AITaskView): boolean {
  return task.state === "planning" || task.state === "running"
}

function phraseForPhase(phase: BookRunPhase, chapter: number): string {
  switch (phase) {
    case "thinking":
      return `Thinking · Chapter ${chapter}`
    case "writing":
      return `Writing Chapter ${chapter}`
    case "validating":
      return `Validating Chapter ${chapter}`
    case "saving":
      return `Saving Chapter ${chapter}`
  }
}

/**
 * One book, as the shell should show it.
 *
 * Pure, and takes the store's fields rather than the store, so every label
 * below is assertable without React or a browser.
 */
export function deriveBookTask(input: {
  project: BookProject | null
  streamingChapter: number | null
  phase: BookRunPhase | null
  planning: { conversationId: string | null; brief: string } | null
}): AITaskView | null {
  const { project, streamingChapter, phase, planning } = input

  // The opening turn. There is no plan yet, so there is nothing to count — and
  // saying "1 of 5" before the model has decided there are five would be an
  // invention rather than a measurement.
  if (!project) {
    if (!planning) return null
    return {
      id: `book:${planning.conversationId ?? NEW_CHAT_KEY}`,
      type: "book",
      title: titleFromBrief(planning.brief),
      status: "Planning",
      state: "planning",
      ...(planning.conversationId ? { conversationId: planning.conversationId } : {}),
    }
  }

  const { done, total } = bookProgress(project)
  const base = {
    id: `book:${project.conversationId}`,
    type: "book" as const,
    title: project.title,
    current: done,
    total,
    ...(project.conversationId && project.conversationId !== NEW_CHAT_KEY
      ? { conversationId: project.conversationId }
      : {}),
  }

  switch (project.status) {
    case "planning":
      return { ...base, status: "Planning", state: "planning" }

    case "writing":
    case "stopping": {
      const chapter = streamingChapter ?? nextChapterNumber(project)
      const work = phase
        ? phraseForPhase(phase, chapter)
        : // Between chapters: the previous one has landed and the next has not
          // opened its stream yet. A real, brief state, and naming it beats
          // holding the last chapter's label over a gap.
          `Starting Chapter ${chapter}`
      return {
        ...base,
        status: project.status === "stopping" ? `${work} · pausing after this` : work,
        state: "running",
      }
    }

    case "paused":
      return {
        ...base,
        status: total > 0 ? `Paused · Chapter ${nextChapterNumber(project)} next` : "Paused",
        state: "paused",
      }

    case "failed":
      return { ...base, status: "Failed", state: "failed" }

    case "completed":
      return { ...base, status: "Completed", state: "completed" }
  }
}

/**
 * A stand-in title for the seconds before the model names the book.
 *
 * The brief is the reader's own words, so the first few of them are the most
 * recognisable label available — better than "Untitled book" for telling two
 * things apart in a list.
 */
function titleFromBrief(brief: string): string {
  const trimmed = brief.trim()
  if (!trimmed) return "New book"
  const words = trimmed.split(/\s+/).slice(0, 7).join(" ")
  return words.length < trimmed.length ? `${words}…` : words
}

/**
 * Is Arciin generating something the reader is waiting on, right now?
 *
 * Deliberately not a hook. The one caller is the idle-logout watcher, which
 * checks on a timer rather than on render — subscribing it to the store would
 * re-render it on every streamed token for no benefit. Reading the same
 * `deriveBookTask` keeps the answer identical to what the sidebar shows, so
 * there is no second definition of "running" to drift.
 *
 * "Running" is deliberately narrow: planning and generating count, and paused,
 * failed and completed do not. A reader whose book is paused is not waiting on
 * anything, and holding their session open would be a security cost with no
 * benefit.
 */
export function hasActiveBackgroundAITask(): boolean {
  const { project, streamingChapter, phase, planning } = useBookRun.getState()
  const task = deriveBookTask({ project, streamingChapter, phase, planning })
  return task !== null && isTaskRunning(task)
}

/** Every AI task the shell should show. Books today; more later. */
export function useAiTasks(): AITaskView[] {
  const project = useBookRun((s) => s.project)
  const streamingChapter = useBookRun((s) => s.streamingChapter)
  const phase = useBookRun((s) => s.phase)
  const planning = useBookRun((s) => s.planning)

  const book = deriveBookTask({ project, streamingChapter, phase, planning })
  return book ? [book] : []
}
