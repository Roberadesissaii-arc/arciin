"use client"

import { create } from "zustand"

type SocketStoreState = {
  connected: boolean
  lastEventAt?: string
  setConnected: (connected: boolean) => void
  setLastEventAt: (lastEventAt?: string) => void
}

export const useSocketStore = create<SocketStoreState>((set) => ({
  connected: false,
  lastEventAt: undefined,
  setConnected: (connected) => set(() => ({ connected })),
  setLastEventAt: (lastEventAt) => set(() => ({ lastEventAt })),
}))
