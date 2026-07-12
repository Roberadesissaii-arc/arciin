"use client"

import { create } from "zustand"

type UiStoreState = {
  commandOpen: boolean
  activityDrawerOpen: boolean
  setCommandOpen: (open: boolean) => void
  setActivityDrawerOpen: (open: boolean) => void
}

export const useUiStore = create<UiStoreState>((set) => ({
  commandOpen: false,
  activityDrawerOpen: false,
  setCommandOpen: (commandOpen) => set(() => ({ commandOpen })),
  setActivityDrawerOpen: (activityDrawerOpen) =>
    set(() => ({ activityDrawerOpen })),
}))
