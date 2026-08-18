"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Pause, Play, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useMusicPlayerStore } from "@/lib/stores/music-player-store"
import { cn } from "@/lib/utils"

const INLINE_DOWNLOAD = "?inline=1"

function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function MusicPlayerBar() {
  const nowPlaying = useMusicPlayerStore((s) => s.nowPlaying)
  const isPlaying = useMusicPlayerStore((s) => s.isPlaying)
  const setIsPlaying = useMusicPlayerStore((s) => s.setIsPlaying)
  const clear = useMusicPlayerStore((s) => s.clear)
  const audioRef = useRef<HTMLAudioElement>(null)
  const loadedTrackIdRef = useRef<string | null>(null)
  const isSeekingRef = useRef(false)

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [seekValue, setSeekValue] = useState(0)
  const [isSeeking, setIsSeeking] = useState(false)
  const [mounted, setMounted] = useState(false)

  const audioSrc = nowPlaying
    ? `/api/assets/${nowPlaying.id}/download${INLINE_DOWNLOAD}`
    : null
  const trackId = nowPlaying?.id ?? null

  useEffect(() => {
    const el = audioRef.current
    if (!el || !audioSrc || !trackId) return

    const trackChanged = loadedTrackIdRef.current !== trackId
    if (trackChanged) {
      loadedTrackIdRef.current = trackId
      setCurrentTime(0)
      setDuration(0)
      setSeekValue(0)
      el.load()
    }

    if (isPlaying) {
      void el.play().catch(() => setIsPlaying(false))
    } else {
      el.pause()
    }
  }, [isPlaying, audioSrc, trackId, setIsPlaying])

  useEffect(() => {
    const el = audioRef.current
    if (!el) return

    const onLoadedMetadata = () => {
      const d = el.duration
      if (Number.isFinite(d) && d > 0) setDuration(d)
    }
    const onDurationChange = onLoadedMetadata
    const onTimeUpdate = () => {
      if (isSeekingRef.current) return
      setCurrentTime(el.currentTime)
      setSeekValue(el.currentTime)
    }
    const onEnded = () => setIsPlaying(false)

    el.addEventListener("loadedmetadata", onLoadedMetadata)
    el.addEventListener("durationchange", onDurationChange)
    el.addEventListener("timeupdate", onTimeUpdate)
    el.addEventListener("ended", onEnded)

    return () => {
      el.removeEventListener("loadedmetadata", onLoadedMetadata)
      el.removeEventListener("durationchange", onDurationChange)
      el.removeEventListener("timeupdate", onTimeUpdate)
      el.removeEventListener("ended", onEnded)
    }
  }, [trackId, setIsPlaying])

  useEffect(() => {
    if (!trackId) loadedTrackIdRef.current = null
  }, [trackId])

  useEffect(() => {
    setMounted(true)
  }, [])

  function commitSeek(value: number) {
    const el = audioRef.current
    if (!el || !Number.isFinite(duration) || duration <= 0) return
    const next = Math.min(Math.max(0, value), duration)
    el.currentTime = next
    setCurrentTime(next)
    setSeekValue(next)
  }

  const sliderMax = duration > 0 ? duration : 0
  const sliderValue = isSeeking ? seekValue : currentTime
  const progressPct =
    sliderMax > 0 ? Math.min(100, (sliderValue / sliderMax) * 100) : 0

  if (!nowPlaying || !mounted) return null

  /**
   * One compact pill, centered — no full-bleed wrapper.
   *
   * An earlier version used `inset-x-0` + `w-full max-w-lg`, which painted a
   * long strip across the bottom and sat above the side panel (z-120 > sheet
   * z-50). The design of the card itself stays; only the chrome around it
   * shrinks to the card. z-40 keeps the right panel on top when both show.
   */
  return createPortal(
    <div
      className={cn(
        "dashboard-main fixed bottom-6 left-1/2 z-40 flex w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2",
        "items-center gap-3 rounded-2xl border border-border/80 bg-card/95 px-3 py-2.5",
        "shadow-lg shadow-black/10 ring-1 ring-black/[0.06] backdrop-blur-xl",
      )}
      role="region"
      aria-label="Music player"
      data-testid="music-player-bar"
    >
      <audio ref={audioRef} src={audioSrc ?? undefined} preload="metadata" className="hidden" />

      <Button
        type="button"
        size="icon"
        variant="default"
        className="size-10 shrink-0 self-end rounded-xl bg-primary text-white hover:bg-primary/90"
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={() => setIsPlaying(!isPlaying)}
      >
        {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
      </Button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {nowPlaying.originalFilename}
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground"
            aria-hidden
          >
            {formatPlaybackTime(sliderValue)}
          </span>
          <div className="relative min-w-0 flex-1">
            <div
              className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-muted"
              aria-hidden
            >
              <div
                className="h-full rounded-full bg-primary/35 transition-[width] duration-75"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <input
              type="range"
              min={0}
              max={sliderMax || 100}
              step={0.05}
              value={sliderMax > 0 ? sliderValue : 0}
              disabled={sliderMax <= 0}
              aria-label="Playback position"
              aria-valuemin={0}
              aria-valuemax={sliderMax}
              aria-valuenow={sliderValue}
              aria-valuetext={`${formatPlaybackTime(sliderValue)} of ${formatPlaybackTime(duration)}`}
              className={cn(
                "music-player-scrubber relative z-[1] h-4 w-full cursor-pointer appearance-none bg-transparent",
                "disabled:cursor-not-allowed disabled:opacity-40",
                "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent",
                "[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
                "[&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm",
                "[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent",
                "[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary",
              )}
              onChange={(e) => {
                const value = Number(e.target.value)
                isSeekingRef.current = true
                setIsSeeking(true)
                setSeekValue(value)
              }}
              onPointerUp={(e) => {
                commitSeek(Number(e.currentTarget.value))
                isSeekingRef.current = false
                setIsSeeking(false)
              }}
              onPointerDown={() => {
                isSeekingRef.current = true
                setIsSeeking(true)
              }}
              onKeyUp={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  commitSeek(Number(e.currentTarget.value))
                  isSeekingRef.current = false
                  setIsSeeking(false)
                }
              }}
              onBlur={() => {
                if (isSeekingRef.current) {
                  commitSeek(seekValue)
                  isSeekingRef.current = false
                  setIsSeeking(false)
                }
              }}
            />
          </div>
          <span
            className="w-9 shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
            aria-hidden
          >
            {formatPlaybackTime(duration)}
          </span>
        </div>
      </div>

      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 shrink-0 self-end text-muted-foreground hover:text-foreground"
        aria-label="Close player"
        onClick={() => clear()}
      >
        <X className="size-4" />
      </Button>
    </div>,
    document.body,
  )
}
