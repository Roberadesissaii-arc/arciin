"use client"

import { create } from "zustand"

type UiStoreState = {
  commandOpen: boolean
  activityDrawerOpen: boolean
  /** Desktop/tablet chat history rail (toggled from header breadcrumb area). */
  chatHistoryOpen: boolean
  setCommandOpen: (open: boolean) => void
  setActivityDrawerOpen: (open: boolean) => void
  setChatHistoryOpen: (open: boolean) => void
  toggleChatHistory: () => void
}

export const useUiStore = create<UiStoreState>((set) => ({
  commandOpen: false,
  activityDrawerOpen: false,
  chatHistoryOpen: false,
  setCommandOpen: (commandOpen) => set(() => ({ commandOpen })),
  setActivityDrawerOpen: (activityDrawerOpen) =>
    set(() => ({ activityDrawerOpen })),
  setChatHistoryOpen: (chatHistoryOpen) => set(() => ({ chatHistoryOpen })),
  toggleChatHistory: () =>
    set((state) => ({ chatHistoryOpen: !state.chatHistoryOpen })),
}))
