/**
 * Where a book project lives between turns.
 *
 * Behind an interface on purpose. Today it is localStorage, because that is
 * where the Canvas drafts already are and the server's message table is
 * text-only — a book project has nowhere durable to go without new tables and
 * routes. A 50,000-word manuscript deserves better than a browser store, so the
 * seam is here: implement `BookProjectRepository` against an API and change the
 * one line in `setBookRepository`, rather than hunting `localStorage` calls
 * through the orchestrator and the components.
 *
 * Nothing outside this file touches storage directly.
 */

import type { BookProject } from "./types"

export interface BookProjectRepository {
  load(conversationId: string | null): BookProject | null
  save(project: BookProject): void
  remove(conversationId: string): void
  /** Move a project begun before the conversation had an id. */
  rekey(conversationId: string): void
  list(): BookProject[]
}

const STORAGE_KEY = "arciin:book-projects.v2"
/** Key for a book begun in a chat whose conversation row does not exist yet. */
export const NEW_CHAT_KEY = "__new__"
/** Enough for the books in flight; older ones fall off rather than grow forever. */
const MAX_PROJECTS = 12

class LocalStorageBookRepository implements BookProjectRepository {
  private readAll(): BookProject[] {
    if (typeof window === "undefined") return []
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw) as BookProject[]
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  private writeAll(projects: BookProject[]) {
    if (typeof window === "undefined") return
    try {
      const trimmed = [...projects]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_PROJECTS)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
    } catch {
      // A full or blocked store costs the plan, not the manuscript — that is
      // saved with the Canvas drafts. Progress is re-derivable from the
      // document, so this is recoverable rather than fatal.
    }
  }

  load(conversationId: string | null): BookProject | null {
    const key = conversationId ?? NEW_CHAT_KEY
    return this.readAll().find((p) => p.conversationId === key) ?? null
  }

  save(project: BookProject) {
    const others = this.readAll().filter((p) => p.conversationId !== project.conversationId)
    this.writeAll([...others, { ...project, updatedAt: Date.now() }])
  }

  remove(conversationId: string) {
    this.writeAll(this.readAll().filter((p) => p.conversationId !== conversationId))
  }

  rekey(conversationId: string) {
    const all = this.readAll()
    const pending = all.find((p) => p.conversationId === NEW_CHAT_KEY)
    if (!pending) return
    this.writeAll([
      ...all.filter(
        (p) => p.conversationId !== NEW_CHAT_KEY && p.conversationId !== conversationId,
      ),
      { ...pending, conversationId },
    ])
  }

  list(): BookProject[] {
    return this.readAll()
  }
}

/** In-memory implementation, so orchestration can be tested without a browser. */
export class MemoryBookRepository implements BookProjectRepository {
  private projects = new Map<string, BookProject>()

  load(conversationId: string | null): BookProject | null {
    return this.projects.get(conversationId ?? NEW_CHAT_KEY) ?? null
  }

  save(project: BookProject) {
    this.projects.set(project.conversationId, { ...project, updatedAt: Date.now() })
  }

  remove(conversationId: string) {
    this.projects.delete(conversationId)
  }

  rekey(conversationId: string) {
    const pending = this.projects.get(NEW_CHAT_KEY)
    if (!pending) return
    this.projects.delete(NEW_CHAT_KEY)
    this.projects.set(conversationId, { ...pending, conversationId })
  }

  list(): BookProject[] {
    return [...this.projects.values()]
  }
}

let repository: BookProjectRepository = new LocalStorageBookRepository()

/** Swap the store — used by tests, and the single edit a durable backend needs. */
export function setBookRepository(next: BookProjectRepository) {
  repository = next
}

export function bookRepository(): BookProjectRepository {
  return repository
}
