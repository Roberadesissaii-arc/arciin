"use client"

import { create } from "zustand"

import { createId } from "@/lib/utils/create-id"

export type InboxNotificationVariant = "default" | "success" | "error" | "warning"

export type InboxNotification = {
  id: string
  title: string
  message?: string
  variant: InboxNotificationVariant
  source: "upload" | "activity" | "security" | "system"
  createdAt: string
  read: boolean
}

const STORAGE_KEY = "arciin_notification_inbox"
const META_KEY = "arciin_notification_inbox_meta"
const MAX_ITEMS = 200

type InboxMeta = {
  /** When true, do not re-import activity feed into inbox after user cleared. */
  activityBackfillDone: boolean
}

function loadPersisted(): InboxNotification[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as InboxNotification[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadMeta(): InboxMeta {
  if (typeof window === "undefined") return { activityBackfillDone: false }
  try {
    const raw = localStorage.getItem(META_KEY)
    if (!raw) return { activityBackfillDone: false }
    const parsed = JSON.parse(raw) as Partial<InboxMeta>
    return { activityBackfillDone: Boolean(parsed.activityBackfillDone) }
  } catch {
    return { activityBackfillDone: false }
  }
}

function persist(items: InboxNotification[]) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)))
  } catch {
    // ignore quota errors
  }
}

function persistMeta(meta: InboxMeta) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta))
  } catch {
    // ignore
  }
}

type NotificationInboxState = {
  items: InboxNotification[]
  hydrated: boolean
  activityBackfillDone: boolean
  hydrate: () => void
  push: (input: {
    id?: string
    title: string
    message?: string
    variant?: InboxNotificationVariant
    source?: InboxNotification["source"]
    read?: boolean
  }) => void
  markRead: (id: string) => void
  markAllRead: () => void
  clearAll: () => void
  setActivityBackfillDone: () => void
}

export const useNotificationInboxStore = create<NotificationInboxState>((set, get) => ({
  items: [],
  hydrated: false,
  activityBackfillDone: false,
  hydrate: () => {
    if (get().hydrated) return
    const meta = loadMeta()
    set({
      items: loadPersisted(),
      hydrated: true,
      activityBackfillDone: meta.activityBackfillDone,
    })
  },
  push: (input) => {
    const id = input.id ?? createId()
    if (get().items.some((entry) => entry.id === id)) {
      return
    }
    const item: InboxNotification = {
      id,
      title: input.title,
      message: input.message,
      variant: input.variant ?? "default",
      source: input.source ?? "system",
      createdAt: new Date().toISOString(),
      read: input.read ?? false,
    }
    const next = [item, ...get().items].slice(0, MAX_ITEMS)
    persist(next)
    set({ items: next, hydrated: true })
  },
  markRead: (id) => {
    const next = get().items.map((n) => (n.id === id ? { ...n, read: true } : n))
    persist(next)
    set({ items: next })
  },
  markAllRead: () => {
    const next = get().items.map((n) => ({ ...n, read: true }))
    persist(next)
    set({ items: next })
  },
  clearAll: () => {
    persist([])
    persistMeta({ activityBackfillDone: true })
    set({ items: [], activityBackfillDone: true })
  },
  setActivityBackfillDone: () => {
    persistMeta({ activityBackfillDone: true })
    set({ activityBackfillDone: true })
  },
}))

export function unreadNotificationCount(items: InboxNotification[]) {
  return items.filter((n) => !n.read).length
}
