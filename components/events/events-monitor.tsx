"use client"

import { useEffect, useRef, useState } from "react"
import { io, type Socket } from "socket.io-client"
import { ChevronDown, ChevronRight, Pause, Play, Trash2, Wifi, WifiOff } from "lucide-react"

import { cn } from "@/lib/utils"
import { socketEventTypes, type SocketEventPayload } from "@/lib/types/events"

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000"
const MAX_EVENTS = 300

type LiveEvent = SocketEventPayload & { _rxAt: string; _uid: string }

// ── colour by category ─────────────────────────────────────────────────────

const CAT_STYLE: Record<string, string> = {
  upload:   "bg-blue-50 border-blue-200 text-blue-800",
  asset:    "bg-violet-50 border-violet-200 text-violet-800",
  thumbnail:"bg-orange-50 border-orange-200 text-orange-800",
  media:    "bg-orange-50 border-orange-200 text-orange-800",
  library:  "bg-emerald-50 border-emerald-200 text-emerald-800",
  job:      "bg-amber-50 border-amber-200 text-amber-800",
  activity: "bg-zinc-50 border-zinc-200 text-zinc-700",
  plex:     "bg-yellow-50 border-yellow-200 text-yellow-800",
}

const DOT_STYLE: Record<string, string> = {
  upload:   "bg-blue-500",
  asset:    "bg-violet-500",
  thumbnail:"bg-orange-500",
  media:    "bg-orange-500",
  library:  "bg-emerald-500",
  job:      "bg-amber-500",
  activity: "bg-zinc-400",
  plex:     "bg-yellow-500",
}

function cat(type: string) { return type.split(".")[0] ?? "activity" }
function catStyle(type: string) { return CAT_STYLE[cat(type)] ?? "bg-zinc-50 border-zinc-200 text-zinc-700" }
function dotStyle(type: string) { return DOT_STYLE[cat(type)] ?? "bg-zinc-400" }

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 1000) return "just now"
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  return new Date(iso).toLocaleTimeString()
}

// ── single event card ──────────────────────────────────────────────────────

function EventCard({ event }: { event: LiveEvent }) {
  const [open, setOpen] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _rxAt, _uid: _uid_, ...payload } = event
  const hasExtra = Object.keys(payload).some(
    k => !["id","type","createdAt","message"].includes(k) && payload[k as keyof typeof payload] != null
  )

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => hasExtra && setOpen(o => !o)}
      >
        {/* dot */}
        <span className={cn("size-2 shrink-0 rounded-full", dotStyle(event.type))} />

        {/* type badge */}
        <span className={cn("shrink-0 rounded-lg border px-2 py-0.5 font-mono text-[11px] font-bold", catStyle(event.type))}>
          {event.type}
        </span>

        {/* message / id */}
        <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-700">
          {event.message ?? event.id ?? "–"}
        </span>

        {/* progress */}
        {typeof event.progress === "number" && (
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[11px] text-zinc-600">
            {event.progress}%
          </span>
        )}

        {/* time */}
        <span className="shrink-0 text-[11px] text-zinc-400">{relTime(_rxAt)}</span>

        {/* expand chevron */}
        {hasExtra && (
          <span className="shrink-0 text-zinc-300">
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </span>
        )}
      </div>

      {/* payload */}
      {open && hasExtra && (
        <div className="border-t border-zinc-100">
          <pre className="overflow-x-auto bg-zinc-950 px-4 py-3 text-[12px] leading-relaxed text-zinc-100">
            <code>{JSON.stringify(payload, null, 2)}</code>
          </pre>
        </div>
      )}
    </div>
  )
}

// ── empty / waiting state ──────────────────────────────────────────────────

function EmptyState({ connected, filter }: { connected: boolean; filter: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 py-16 text-center">
      {connected ? (
        <>
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <Wifi className="size-5 text-primary" />
          </span>
          <p className="text-[14px] font-medium text-zinc-800">Listening for events…</p>
          <p className="text-[13px] text-zinc-500">
            {filter === "all"
              ? "Any activity on this instance will appear here in real time."
              : `Waiting for events matching "${filter}.*".`}
          </p>
        </>
      ) : (
        <>
          <span className="flex size-10 items-center justify-center rounded-full bg-zinc-100">
            <WifiOff className="size-5 text-zinc-400" />
          </span>
          <p className="text-[14px] font-medium text-zinc-800">Not connected</p>
          <p className="text-[13px] text-zinc-500">Connecting to {SOCKET_URL}…</p>
        </>
      )}
    </div>
  )
}

// ── main monitor ───────────────────────────────────────────────────────────

const CATEGORIES = ["all", "upload", "asset", "media", "library", "job", "activity", "plex"] as const

export function EventsMonitor() {
  const [connected, setConnected] = useState(false)
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState<string>("all")
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [bufferedCount, setBufferedCount] = useState(0)

  const pausedRef = useRef(false)
  const bufferRef = useRef<LiveEvent[]>([])

  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, { withCredentials: true, transports: ["websocket", "polling"] })

    socket.on("connect", () => { setConnected(true); setError(null) })
    socket.on("disconnect", () => setConnected(false))
    socket.on("connect_error", (err) => {
      setConnected(false)
      setError(err.message)
    })

    socket.onAny((type: string, incoming: SocketEventPayload) => {
      const event: LiveEvent = {
        id: incoming?.id || crypto.randomUUID(),
        type: (incoming?.type ?? type) as SocketEventPayload["type"],
        userId: incoming?.userId,
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

      setTotal(t => t + 1)

      if (!pausedRef.current) {
        setEvents(prev => [event, ...prev].slice(0, MAX_EVENTS))
      } else {
        bufferRef.current.unshift(event)
        setBufferedCount(c => c + 1)
      }
    })

    return () => { socket.disconnect() }
  }, [])

  function togglePause() {
    const next = !paused
    pausedRef.current = next
    if (!next) {
      const buffered = bufferRef.current.splice(0)
      setEvents(prev => [...buffered, ...prev].slice(0, MAX_EVENTS))
      setBufferedCount(0)
    }
    setPaused(next)
  }

  function clear() {
    setEvents([])
    bufferRef.current = []
    setTotal(0)
    setBufferedCount(0)
  }

  const filtered = filter === "all" ? events : events.filter(e => cat(e.type) === filter)

  return (
    <div className="space-y-4">
      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 shadow-sm">
        {/* connection pill */}
        <div className={cn(
          "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold",
          connected
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : "border-zinc-200 bg-zinc-50 text-zinc-500",
        )}>
          <span className={cn("size-2 rounded-full", connected ? "bg-emerald-500 animate-pulse" : "bg-zinc-400")} />
          {connected ? "Connected" : error ? "Error" : "Connecting…"}
        </div>

        <span className="font-mono text-[12px] text-zinc-400">{SOCKET_URL}</span>

        {error && (
          <span className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] text-red-700">
            {error}
          </span>
        )}

        <div className="flex-1" />

        {/* buffered badge */}
        {paused && bufferedCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700">
            {bufferedCount} buffered
          </span>
        )}

        {/* total count */}
        <span className="text-[12px] text-zinc-400 tabular-nums">{total} received</span>

        {/* pause / resume */}
        <button
          type="button"
          onClick={togglePause}
          className={cn(
            "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors",
            paused
              ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
              : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100",
          )}
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
          {paused ? "Resume" : "Pause"}
        </button>

        {/* clear */}
        <button
          type="button"
          onClick={clear}
          className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[12px] font-semibold text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-red-600"
        >
          <Trash2 className="size-3.5" />
          Clear
        </button>
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map(c => {
          const count = c === "all" ? events.length : events.filter(e => cat(e.type) === c).length
          return (
            <button
              key={c}
              type="button"
              onClick={() => setFilter(c)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors",
                filter === c
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900",
              )}
            >
              {c}
              {count > 0 && (
                <span className={cn(
                  "ml-1.5 rounded-md px-1.5 py-0.5 text-[10px] tabular-nums",
                  filter === c ? "bg-primary/15 text-primary" : "bg-zinc-100 text-zinc-500",
                )}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Event list */}
      <div className="space-y-2">
        {paused && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] font-medium text-amber-700">
            Stream paused — {bufferedCount} new event{bufferedCount !== 1 ? "s" : ""} buffered. Click Resume to flush.
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyState connected={connected} filter={filter} />
        ) : (
          filtered.map(event => <EventCard key={event._uid} event={event} />)
        )}
      </div>

      {/* Event type reference */}
      <details className="group rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer select-none items-center justify-between px-5 py-4">
          <span className="text-[14px] font-semibold text-zinc-900">Event type reference</span>
          <ChevronDown className="size-4 text-zinc-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-zinc-100 px-5 py-4">
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {socketEventTypes.map(t => (
              <div
                key={t}
                className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-zinc-400" />
                <span className="font-mono text-[12px] text-zinc-700">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </details>
    </div>
  )
}
