"use client"

/**
 * Active book runs, from the server.
 *
 * One query, shared by the sidebar indicator, the hover popover and the History
 * rows, so all three agree and only one request is in flight. Polled rather than
 * pushed: Arciin's socket layer carries library events, and a book transition is
 * a handful of writes per chapter — a light poll is the smaller change and is
 * plenty quick for "which chapter is it on".
 *
 * The interval backs right off when nothing is running, so an idle instance is
 * not asking every few seconds forever.
 */

import { useQuery } from "@tanstack/react-query"

import { isBookRunActive, listBookRuns, type BookRunView } from "@/lib/api/book-runs"

export const bookRunsQueryKey = ["book-runs"] as const

/** While a book is writing. Fast enough to feel live on a second computer. */
const ACTIVE_POLL_MS = 4000
/** When nothing is running — just enough to notice a run starting elsewhere. */
const IDLE_POLL_MS = 30_000

export function useBookRuns(): {
  runs: BookRunView[]
  active: BookRunView[]
  isLoading: boolean
} {
  const query = useQuery({
    queryKey: bookRunsQueryKey,
    queryFn: ({ signal }) => listBookRuns(signal),
    refetchInterval: (q) => {
      const runs = q.state.data?.runs ?? []
      return runs.some((r) => isBookRunActive(r.status)) ? ACTIVE_POLL_MS : IDLE_POLL_MS
    },
    // A book started on another computer should appear when this tab is looked
    // at again, without waiting out the idle interval.
    refetchOnWindowFocus: true,
    staleTime: 2000,
  })

  const runs = query.data?.runs ?? []
  return {
    runs,
    active: runs.filter((r) => isBookRunActive(r.status)),
    isLoading: query.isLoading,
  }
}

/** The run for one conversation, from the shared list. */
export function useBookRunFor(conversationId: string | null): BookRunView | null {
  const { runs } = useBookRuns()
  if (!conversationId) return null
  return runs.find((r) => r.conversationId === conversationId) ?? null
}
