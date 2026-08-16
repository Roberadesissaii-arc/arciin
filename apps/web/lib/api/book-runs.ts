/**
 * Book run state, shared across this user's sessions.
 *
 * The sidebar indicator, the History rows and the Book Progress Card all read
 * from here, so a book running on one computer is visible on another. Execution
 * still happens in one browser; everything else observes.
 */

import { fetchApi } from "@/lib/api/client"

export const BOOK_RUN_ACTIVE_STATUSES = [
  "PLANNING",
  "THINKING",
  "WRITING",
  "VALIDATING",
  "SAVING",
] as const

export type BookRunStatus =
  | (typeof BOOK_RUN_ACTIVE_STATUSES)[number]
  | "PAUSED"
  | "INTERRUPTED"
  | "FAILED"
  | "COMPLETED"

export type BookRunView = {
  id: string
  conversationId: string
  title: string
  status: BookRunStatus
  totalChapters: number
  writtenChapters: number
  currentChapter: number
  currentChapterTitle: string | null
  error: string | null
  /** This session owns generation. Only it may write chapters. */
  isExecutor: boolean
  /** Someone else is writing — observe, do not generate. */
  executedElsewhere: boolean
  startedAt: string
  updatedAt: string
  finishedAt: string | null
  manuscript?: string
}

/** Work the reader is waiting on right now. */
export function isBookRunActive(status: BookRunStatus): boolean {
  return (BOOK_RUN_ACTIVE_STATUSES as readonly string[]).includes(status)
}

/** A sentence for a person: "Writing Chapter 4 of 10". */
export function describeBookRun(run: BookRunView): string {
  const of = run.totalChapters > 0 ? ` of ${run.totalChapters}` : ""
  switch (run.status) {
    case "PLANNING":
      return "Planning the book"
    case "THINKING":
      return `Thinking · Chapter ${run.currentChapter}${of}`
    case "WRITING":
      return `Writing Chapter ${run.currentChapter}${of}`
    case "VALIDATING":
      return `Checking Chapter ${run.currentChapter}${of}`
    case "SAVING":
      return `Saving Chapter ${run.currentChapter}${of}`
    case "PAUSED":
      return `Paused · Chapter ${run.currentChapter}${of} next`
    case "INTERRUPTED":
      return `Interrupted · Chapter ${run.currentChapter}${of} next`
    case "FAILED":
      return `Failed at Chapter ${run.currentChapter}`
    case "COMPLETED":
      return `Completed · ${run.writtenChapters} chapters`
  }
}

export function listBookRuns(signal?: AbortSignal) {
  return fetchApi<{ runs: BookRunView[] }>("/book-runs", { signal })
}

export function getBookRun(conversationId: string, signal?: AbortSignal) {
  return fetchApi<{ run: BookRunView | null }>(
    `/conversations/${conversationId}/book-run`,
    { signal },
  )
}

export type BookRunUpdate = {
  title?: string
  status: BookRunStatus
  totalChapters?: number
  writtenChapters?: number
  currentChapter?: number
  currentChapterTitle?: string | null
  manuscript?: string
  error?: string | null
  claim?: boolean
}

/** Publish progress. Rejected with 409 if another session holds the lease. */
export function putBookRun(conversationId: string, update: BookRunUpdate) {
  return fetchApi<{ run: BookRunView }>(`/conversations/${conversationId}/book-run`, {
    method: "PUT",
    body: update,
  })
}

/** Refresh the lease. Cheap by design — called on a timer, not per token. */
export function heartbeatBookRun(conversationId: string) {
  return fetchApi<{ run: BookRunView }>(
    `/conversations/${conversationId}/book-run/heartbeat`,
    { method: "POST" },
  )
}
