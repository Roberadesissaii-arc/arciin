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

export function BookTaskProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // No cleanup on purpose. Unmounting the app root means the page is going
    // away entirely, and the recovery path handles that far better than
    // tearing the transport down would.
    useBookRun.getState().setGenerator(createChapterGenerator(getBookTransportConfig))
  }, [])

  return <>{children}</>
}
