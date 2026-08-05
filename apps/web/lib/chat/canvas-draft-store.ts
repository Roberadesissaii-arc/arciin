/**
 * Persist Canvas drafts per conversation/message in localStorage so history
 * can reopen the essay after leaving the chat. Server message table stays text-only.
 */

export type CanvasDraftRecord = {
  id: string
  conversationId: string | null
  messageId: string
  title: string
  content: string
  updatedAt: string
}

const STORAGE_KEY = "arciin.canvas-drafts.v1"

function readAll(): Record<string, CanvasDraftRecord> {
  if (typeof window === "undefined") return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, CanvasDraftRecord>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(map: Record<string, CanvasDraftRecord>) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* quota / private mode */
  }
}

export function canvasDraftKey(conversationId: string | null, messageId: string): string {
  return `${conversationId ?? "local"}:${messageId}`
}

export function saveCanvasDraft(draft: CanvasDraftRecord): void {
  const all = readAll()
  all[canvasDraftKey(draft.conversationId, draft.messageId)] = {
    ...draft,
    updatedAt: new Date().toISOString(),
  }
  writeAll(all)
}

export function getCanvasDraft(
  conversationId: string | null,
  messageId: string,
): CanvasDraftRecord | null {
  return readAll()[canvasDraftKey(conversationId, messageId)] ?? null
}

/** Hydrate drafts for a conversation when loading history. */
export function listCanvasDraftsForConversation(
  conversationId: string,
): CanvasDraftRecord[] {
  const all = readAll()
  return Object.values(all).filter((d) => d.conversationId === conversationId)
}

export function rekeyCanvasDraftsForConversation(
  fromConversationId: string | null,
  toConversationId: string,
  messageIdMap: Array<{ fromId: string; toId: string }>,
): void {
  if (!toConversationId) return
  const all = readAll()
  let changed = false
  for (const { fromId, toId } of messageIdMap) {
    const oldKey = canvasDraftKey(fromConversationId, fromId)
    const draft = all[oldKey]
    if (!draft) continue
    delete all[oldKey]
    const next: CanvasDraftRecord = {
      ...draft,
      id: toId,
      messageId: toId,
      conversationId: toConversationId,
      updatedAt: new Date().toISOString(),
    }
    all[canvasDraftKey(toConversationId, toId)] = next
    changed = true
  }
  if (changed) writeAll(all)
}

export function deleteCanvasDraftsForConversation(conversationId: string): void {
  const all = readAll()
  let changed = false
  for (const key of Object.keys(all)) {
    if (all[key]?.conversationId === conversationId) {
      delete all[key]
      changed = true
    }
  }
  if (changed) writeAll(all)
}
