"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatMediaDuration } from "@/lib/utils/format-duration"
import { cn } from "@/lib/utils"

function formatTime(seconds: number) {
  return formatMediaDuration(seconds) ?? "0:00"
}

export function VideoAssetViewer({
  src,
  className,
}: {
  src: string
  className?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSeekingRef = useRef(false)

  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [seekValue, setSeekValue] = useState(0)
  const [isSeeking, setIsSeeking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  const scheduleHideControls = useCallback(() => {
    clearHideTimer()
    hideTimerRef.current = setTimeout(() => {
      const el = videoRef.current
      if (el && !el.paused) setControlsVisible(false)
    }, 2400)
  }, [clearHideTimer])

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    scheduleHideControls()
  }, [scheduleHideControls])

  useEffect(() => {
    return () => clearHideTimer()
  }, [clearHideTimer])

  /**
   * Reset playback state when the source changes.
   *
   * Adjusted during render rather than in an effect: React applies a guarded
   * render-phase update before committing, so the viewer never paints one
   * frame of the previous video's state. Doing it in an effect meant a commit
   * with stale values followed by a second render — the cascading-render
   * pattern React warns about.
   */
  const [lastSrc, setLastSrc] = useState(src)
  if (src !== lastSrc) {
    setLastSrc(src)
    setReady(false)
    setError(null)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setSeekValue(0)
    setControlsVisible(true)
  }

  useEffect(() => {
    const onFs = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener("fullscreenchange", onFs)
    return () => document.removeEventListener("fullscreenchange", onFs)
  }, [])

  const togglePlay = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) {
      void el.play().catch(() => setPlaying(false))
    } else {
      el.pause()
    }
    revealControls()
  }, [revealControls])

  const commitSeek = useCallback((value: number) => {
    const el = videoRef.current
    if (!el || !Number.isFinite(duration) || duration <= 0) return
    const next = Math.min(Math.max(0, value), duration)
    el.currentTime = next
    setCurrentTime(next)
    setSeekValue(next)
  }, [duration])

  const toggleMute = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    el.muted = !el.muted
    setMuted(el.muted)
    revealControls()
  }, [revealControls])

  const onVolumeChange = useCallback(
    (value: number) => {
      const el = videoRef.current
      if (!el) return
      const next = Math.min(1, Math.max(0, value))
      el.volume = next
      el.muted = next === 0
      setVolume(next)
      setMuted(next === 0)
      revealControls()
    },
    [revealControls],
  )

  const toggleFullscreen = useCallback(async () => {
    const shell = shellRef.current
    if (!shell) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await shell.requestFullscreen()
      }
    } catch {
      /* browser may block fullscreen */
    }
    revealControls()
  }, [revealControls])

  const sliderMax = duration > 0 ? duration : 0
  const sliderValue = isSeeking ? seekValue : currentTime
  const progressPct =
    sliderMax > 0 ? Math.min(100, (sliderValue / sliderMax) * 100) : 0

  return (
    <div
      className={cn(
        "relative flex h-full items-center justify-center bg-zinc-50 p-4 sm:p-6",
        className,
      )}
    >
      {!ready && !error ? (
        <Loader2 className="absolute size-8 animate-spin text-zinc-500" aria-hidden />
      ) : null}
      {error ? (
        <p className="max-w-md px-4 text-center text-sm text-zinc-500">{error}</p>
      ) : (
        <div
          ref={shellRef}
          className={cn(
            "group/video relative max-h-full max-w-full overflow-hidden rounded-xl",
            "bg-zinc-950 shadow-[0_4px_24px_rgba(0,0,0,0.12)] ring-1 ring-black/10",
            !ready && "opacity-0",
            isFullscreen && "rounded-none",
          )}
          onMouseMove={revealControls}
          onMouseLeave={() => {
            if (playing) {
              clearHideTimer()
              setControlsVisible(false)
            }
          }}
        >
          <video
            ref={videoRef}
            key={src}
            src={src}
            playsInline
            preload="metadata"
            crossOrigin="use-credentials"
            className="block max-h-[min(100%,calc(100dvh-8rem))] max-w-full cursor-pointer object-contain"
            onClick={togglePlay}
            onLoadedData={() => setReady(true)}
            onLoadedMetadata={() => {
              const el = videoRef.current
              if (!el) return
              if (Number.isFinite(el.duration) && el.duration > 0) {
                setDuration(el.duration)
              }
            }}
            onDurationChange={() => {
              const el = videoRef.current
              if (el && Number.isFinite(el.duration) && el.duration > 0) {
                setDuration(el.duration)
              }
            }}
            onTimeUpdate={() => {
              const el = videoRef.current
              if (!el || isSeekingRef.current) return
              setCurrentTime(el.currentTime)
              setSeekValue(el.currentTime)
            }}
            onPlay={() => {
              setPlaying(true)
              scheduleHideControls()
            }}
            onPause={() => {
              setPlaying(false)
              setControlsVisible(true)
              clearHideTimer()
            }}
            onEnded={() => {
              setPlaying(false)
              setControlsVisible(true)
            }}
            onVolumeChange={() => {
              const el = videoRef.current
              if (!el) return
              setMuted(el.muted)
              setVolume(el.volume)
            }}
            onError={() => {
              setError("Could not play this video. Try downloading the file instead.")
              setReady(true)
            }}
          />

          {/* Center play affordance when paused */}
          {ready && !playing ? (
            <button
              type="button"
              className="absolute inset-0 z-[1] flex items-center justify-center bg-black/0 transition-colors hover:bg-black/10"
              aria-label="Play"
              onClick={togglePlay}
            >
              <span className="flex size-14 items-center justify-center rounded-2xl bg-black/35 text-white shadow-lg ring-1 ring-white/20 backdrop-blur-md">
                <Play className="size-6 translate-x-0.5" fill="currentColor" />
              </span>
            </button>
          ) : null}

          {/* Custom control bar — light frosted glass over the video */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-black/40 via-black/15 to-transparent px-3 pb-3 pt-10 transition-opacity duration-200",
              controlsVisible || !playing ? "opacity-100" : "opacity-0",
            )}
          >
            <div
              className={cn(
                "pointer-events-auto flex flex-col gap-2 rounded-xl border border-white/15",
                "bg-zinc-950/45 px-3 py-2.5 shadow-lg backdrop-blur-md backdrop-saturate-150",
              )}
            >
              {/* Progress */}
              <div className="relative min-w-0">
                <div
                  className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-white/15"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-75"
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
                  aria-valuetext={`${formatTime(sliderValue)} of ${formatTime(duration)}`}
                  className={cn(
                    "relative z-[1] h-4 w-full cursor-pointer appearance-none bg-transparent",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                    "[&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent",
                    "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full",
                    "[&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(255,79,18,0.25)]",
                    "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent",
                    "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary",
                  )}
                  onChange={(e) => {
                    const value = Number(e.target.value)
                    isSeekingRef.current = true
                    setIsSeeking(true)
                    setSeekValue(value)
                    revealControls()
                  }}
                  onPointerUp={() => {
                    commitSeek(seekValue)
                    isSeekingRef.current = false
                    setIsSeeking(false)
                    revealControls()
                  }}
                  onKeyUp={() => {
                    commitSeek(seekValue)
                    isSeekingRef.current = false
                    setIsSeeking(false)
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

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  className="size-9 shrink-0 rounded-xl bg-primary text-white hover:bg-primary/90"
                  aria-label={playing ? "Pause" : "Play"}
                  onClick={togglePlay}
                >
                  {playing ? (
                    <Pause className="size-4" />
                  ) : (
                    <Play className="size-4 translate-x-px" fill="currentColor" />
                  )}
                </Button>

                <span className="min-w-[5.5rem] font-mono text-[11px] tabular-nums text-zinc-300">
                  {formatTime(sliderValue)}
                  <span className="text-zinc-500"> / </span>
                  {formatTime(duration)}
                </span>

                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0 rounded-lg text-zinc-200 hover:bg-white/10 hover:text-white"
                    aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                    onClick={toggleMute}
                  >
                    {muted || volume === 0 ? (
                      <VolumeX className="size-4" />
                    ) : (
                      <Volume2 className="size-4" />
                    )}
                  </Button>

                  <div className="relative hidden w-20 sm:block">
                    <div
                      className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/15"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-white/70"
                        style={{ width: `${(muted ? 0 : volume) * 100}%` }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.02}
                      value={muted ? 0 : volume}
                      aria-label="Volume"
                      className={cn(
                        "relative z-[1] h-4 w-full cursor-pointer appearance-none bg-transparent",
                        "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent",
                        "[&::-webkit-slider-thumb]:size-2.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white",
                        "[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent",
                        "[&::-moz-range-thumb]:size-2.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white",
                      )}
                      onChange={(e) => onVolumeChange(Number(e.target.value))}
                    />
                  </div>

                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0 rounded-lg text-zinc-200 hover:bg-white/10 hover:text-white"
                    aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                    onClick={() => void toggleFullscreen()}
                  >
                    {isFullscreen ? (
                      <Minimize2 className="size-4" />
                    ) : (
                      <Maximize2 className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
