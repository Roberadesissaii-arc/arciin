"use client"

import { create } from "zustand"

import type { AssetSummary } from "@/lib/types/models"

type MusicPlayerState = {
  nowPlaying: AssetSummary | null
  isPlaying: boolean
  setNowPlaying: (asset: AssetSummary | null) => void
  setIsPlaying: (isPlaying: boolean) => void
  clear: () => void
}

export const useMusicPlayerStore = create<MusicPlayerState>((set) => ({
  nowPlaying: null,
  isPlaying: false,
  setNowPlaying: (nowPlaying) =>
    set(() => ({
      nowPlaying,
      isPlaying: nowPlaying ? true : false,
    })),
  setIsPlaying: (isPlaying) => set(() => ({ isPlaying })),
  clear: () => set(() => ({ nowPlaying: null, isPlaying: false })),
}))
