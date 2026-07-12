"use client"

import { create } from "zustand"

import type { SocketEventPayload } from "@/lib/types/events"

export type LiveSocketEvent = SocketEventPayload & {
  _rxAt: string
  _uid: string
}

const MAX_FEED = 300

type EventsFeedState = {
  events: LiveSocketEvent[]
  total: number
  push: (event: LiveSocketEvent) => void
  clear: () => void
}

export const useEventsFeedStore = create<EventsFeedState>((set) => ({
  events: [],
  total: 0,
  push: (event) =>
    set((state) => ({
      total: state.total + 1,
      events: [event, ...state.events].slice(0, MAX_FEED),
    })),
  clear: () => set({ events: [], total: 0 }),
}))

export function buildLiveSocketEvent(
  type: string,
  incoming: SocketEventPayload,
): LiveSocketEvent {
  return {
    id: incoming?.id || crypto.randomUUID(),
    type: (incoming?.type ?? type) as SocketEventPayload["type"],
    userId: incoming?.userId,
    instanceId: incoming?.instanceId,
    libraryId: incoming?.libraryId,
    uploadId: incoming?.uploadId,
    assetId: incoming?.assetId,
    jobId: incoming?.jobId,
    progress: incoming?.progress,
    message: incoming?.message,
    data: incoming?.data,
    createdAt: incoming?.createdAt || new Date().toISOString(),
    _rxAt: new Date().toISOString(),
    _uid: crypto.randomUUID(),
  }
}
