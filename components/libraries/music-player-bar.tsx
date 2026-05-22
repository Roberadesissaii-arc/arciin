"use client"

import { useEffect, useRef } from "react"
import { Pause, Play, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/utils/format-bytes"
import { useMusicPlayerStore } from "@/lib/stores/music-player-store"
import { cn } from "@/lib/utils"

const INLINE_DOWNLOAD = "?inline=1"

export function MusicPlayerBar() {
  const nowPlaying = useMusicPlayerStore((s) => s.nowPlaying)
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying)
  const setIsPlaying = useMusicPlayerStore((s) => s.setIsPlaying)
  const clear = useMusicPlayerStore((s) => s.clear)
  const audioRef = useRef<HTMLAudioElement>(null)

  const audioSrc = nowPlaying
    ? `/api/assets/${nowPlaying.id}/download${INLINE_DOWNLOAD}`
    : null

  useEffect(() => {
    const el = audioRef.current
    if (!el || !audioSrc) return
    el.load()
    if (isPlaying) {
      void el.play().catch(() => setIsPlaying(false))
    } else {
      el.pause()
    }
  }, [isPlaying, audioSrc, setIsPlaying, nowPlaying?.id])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onEnded = () => setIsPlaying(false)
    el.addEventListener("ended", onEnded)
    return () => el.removeEventListener("ended", onEnded)
  }, [setIsPlaying, nowPlaying?.id])

  if (!nowPlaying) return null

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4"
      role="region"
      aria-label="Music player"
    >
      <div
        className={cn(
          "pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-border/80",
          "bg-card/95 px-3 py-2.5 shadow-lg shadow-black/10 ring-1 ring-black/[0.06] backdrop-blur-xl",
        )}
      >
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio ref={audioRef} src={audioSrc ?? undefined} preload="metadata" className="hidden" />

        <Button
          type="button"
          size="icon"
          variant="default"
          className="size-10 shrink-0 rounded-xl bg-primary text-white hover:bg-primary/90"
          aria-label={isPlaying ? "Pause" : "Play"}
          onClick={() => setIsPlaying(!isPlaying)}
        >
          {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {nowPlaying.originalFilename}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {formatBytes(nowPlaying.sizeBytes)}
          </p>
        </div>

        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Close player"
          onClick={() => clear()}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
