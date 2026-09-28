"use client"

import { create } from "zustand"

/** How long a folder shows "Received" after its last incoming upload lands. */
export const RECEIVED_FLASH_MS = 3000

type IncomingStoreState = {
  /** folderId → when its last incoming upload completed. UI-only; the server snapshot is the truth. */
  receivedAt: Record<string, number>
  markReceived: (folderId: string) => void
  clearReceived: (folderId: string) => void
}

export const useIncomingStore = create<IncomingStoreState>((set) => ({
  receivedAt: {},
  markReceived: (folderId) => set((s) => ({ receivedAt: { ...s.receivedAt, [folderId]: Date.now() } })),
  clearReceived: (folderId) =>
    set((s) => {
      if (!(folderId in s.receivedAt)) return s
      const next = { ...s.receivedAt }
      delete next[folderId]
      return { receivedAt: next }
    }),
}))
