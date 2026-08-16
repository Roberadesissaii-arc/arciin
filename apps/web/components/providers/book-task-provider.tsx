"use client"

/**
 * Book writing, owned by the application rather than by a route.
 *
 * The orchestrator was always module-level — the store, the lock and the abort
 * controller all outlive any render. What tied a book to the Chat page was this
 * registration: it lived in a `ChatPage` effect whose cleanup set the generator
 * back to null, so navigating to Files unregistered the transport and the next
 * chapter found `generator_unavailable` and stopped.
 *
 * Mounted once at the app root, it never unregisters, and a route change is
 * just a route change.
 */

import { useEffect } from "react"

import { createChapterGenerator } from "@/lib/chat/book/book-chapter-generator"
import { useBookRun } from "@/lib/chat/book/book-orchestrator"
import { getBookTransportConfig } from "@/lib/chat/book/book-transport"
import { heartbeatBookRun, putBookRun } from "@/lib/api/book-runs"

export function BookTaskProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // No cleanup on purpose. Unmounting the app root means the page is going
    // away entirely, and the recovery path handles that far better than
    // tearing the transport down would.
    useBookRun.getState().setGenerator(createChapterGenerator(getBookTransportConfig))

    /**
     * Publish progress to the server, and let it arbitrate who generates.
     *
     * Registered here rather than in Chat for the same reason the transport is:
     * a book keeps running while the reader is on All Files, and its status has
     * to keep reaching the server for other computers to see it.
     */
    useBookRun.getState().setRunSync({
      publish: async (input) => {
        try {
          const { run } = await putBookRun(input.conversationId, {
            status: input.status as never,
            ...(input.title ? { title: input.title } : {}),
            ...(input.totalChapters !== undefined ? { totalChapters: input.totalChapters } : {}),
            ...(input.writtenChapters !== undefined
              ? { writtenChapters: input.writtenChapters }
              : {}),
            ...(input.currentChapter !== undefined
              ? { currentChapter: input.currentChapter }
              : {}),
            ...(input.currentChapterTitle !== undefined
              ? { currentChapterTitle: input.currentChapterTitle }
              : {}),
            ...(input.manuscript ? { manuscript: input.manuscript } : {}),
            ...(input.error !== undefined ? { error: input.error } : {}),
          })
          return { executedElsewhere: run.executedElsewhere }
        } catch (error) {
          // 409 is the server saying another session owns the run. That is an
          // answer, not a failure — the caller must not generate.
          const status = (error as { status?: number } | null)?.status
          if (status === 409) return { executedElsewhere: true }
          throw error
        }
      },
      heartbeat: async (conversationId) => {
        await heartbeatBookRun(conversationId)
      },
    })

    /**
     * A handle on the run, for tests and for support.
     *
     * The shell's running-work indicator is worth asserting in a browser —
     * that it spins, explains itself on hover and links to the right
     * conversation — and none of that should cost a real book to check. This
     * exposes the same store the UI already reads; it holds no secrets, and
     * the manuscript is in localStorage beside it either way.
     */
    ;(window as unknown as { __arciinBookRun?: typeof useBookRun }).__arciinBookRun = useBookRun
  }, [])

  return <>{children}</>
}
