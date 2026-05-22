import { useMusicPlayerStore } from "@/lib/stores/music-player-store"
import type { AssetSummary } from "@/lib/types/models"

/** Play or pause in the bottom music bar (never opens the file preview workspace). */
export function toggleMusicAsset(asset: AssetSummary) {
  const { nowPlaying, isPlaying, setNowPlaying, setIsPlaying } = useMusicPlayerStore.getState()
  if (nowPlaying?.id === asset.id) {
    setIsPlaying(!isPlaying)
    return
  }
  setNowPlaying(asset)
}

export function useIsMusicAssetActive(assetId: string) {
  const nowPlayingId = useMusicPlayerStore((s) => s.nowPlaying?.id)
  return nowPlayingId === assetId
}

export function useIsMusicAssetPlaying(assetId: string) {
  const nowPlayingId = useMusicPlayerStore((s) => s.nowPlaying?.id)
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying)
  return nowPlayingId === assetId && isPlaying
}
