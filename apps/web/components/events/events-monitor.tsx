"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  Radio,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { getClientSocketUrl, getSocketUrlSsrDefault } from "@/lib/realtime/client-socket-url"
import { useEventsFeedStore, type LiveSocketEvent } from "@/lib/stores/events-feed-store"
import { useSocketStore } from "@/lib/stores/socket-store"
import { socketEventTypes } from "@/lib/types/events"

const MAX_EVENTS = 300

const CAT_STYLE: Record<string, string> = {
  upload: "border-l-blue-500 bg-blue-50/50",
  asset: "border-l-violet-500 bg-violet-50/40",
  thumbnail: "border-l-orange-500 bg-orange-50/40",
  media: "border-l-orange-500 bg-orange-50/40",
  library: "border-l-emerald-500 bg-emerald-50/40",
  job: "border-l-amber-500 bg-amber-50/40",
  activity: "border-l-zinc-400 bg-zinc-50/80",
  plex: "border-l-yellow-500 bg-yellow-50/40",
}

const BADGE_STYLE: Record<string, string> = {
  upload: "border-blue-200/80 bg-blue-50 text-blue-800",
  asset: "border-violet-200/80 bg-violet-50 text-violet-800",
  thumbnail: "border-orange-200/80 bg-orange-50 text-orange-800",
  media: "border-orange-200/80 bg-orange-50 text-orange-800",
  library: "border-emerald-200/80 bg-emerald-50 text-emerald-800",
  job: "border-amber-200/80 bg-amber-50 text-amber-900",
  activity: "border-zinc-200/80 bg-zinc-100 text-zinc-700",
  plex: "border-yellow-200/80 bg-yellow-50 text-yellow-900",
}

function cat(type: string) {
  return type.split(".")[0] ?? "activity"
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 1000) return "just now"
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  return new Date(iso).toLocaleTimeString()
}

function EventCard({ event }: { event: LiveSocketEvent }) {
  const [open, setOpen] = useState(false)
  const category = cat(event.type)

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _rxAt, _uid: _uid_, ...payload } = event
  const hasExtra = Object.keys(payload).some(
    (k) => !["id", "type", "createdAt", "message"].includes(k) && payload[k as keyof typeof payload] != null,
  )

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-zinc-200/90 border-l-[3px] bg-white shadow-sm transition-all hover:shadow-md",
        CAT_STYLE[category] ?? "border-l-zinc-300 bg-white",
      )}
    >
      <div
        className="flex cursor-pointer select-none items-center gap-3 px-4 py-3"
        onClick={() => hasExtra && setOpen((o) => !o)}
      >
        <span
          className={cn(
            "shrink-0 rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold",
            BADGE_STYLE[category] ?? "border-zinc-200 bg-zinc-50 text-zinc-700",
          )}
        >
          {event.type}
        </span>

        <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-800">
          {event.message ?? event.id ?? "–"}
        </span>

        {typeof event.progress === "number" && (
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-zinc-600">
            {event.progress}%
          </span>
        )}

        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{relTime(_rxAt)}</span>

        {hasExtra && (
          <span className="shrink-0 text-zinc-300">
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </span>
        )}
      </div>

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

function EmptyState({
  connected,
  filter,
  lastEventAt,
}: {
  connected: boolean
  filter: string
  lastEventAt?: string
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 px-6 py-16 text-center">
      {connected ? (
        <>
          <span className="relative flex size-12 items-center justify-center rounded-full bg-primary/10">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
            <Wifi className="relative size-5 text-primary" />
          </span>
          <p className="text-[15px] font-semibold tracking-tight text-zinc-900">Listening for events…</p>
          <p className="max-w-md text-[13px] leading-relaxed text-zinc-500">
            {filter === "all"
              ? "Keep this page open, then upload from mobile or desktop. Events are live only — nothing replays from before you arrived."
              : `Waiting for events matching "${filter}.*".`}
          </p>
          {lastEventAt ? (
            <p className="text-[11px] font-medium text-emerald-600">
              Last socket event · {relTime(lastEventAt)}
            </p>
          ) : (
            <p className="text-[11px] text-zinc-400">No socket events received yet on this browser session.</p>
          )}
        </>
      ) : (
        <>
          <span className="flex size-12 items-center justify-center rounded-full bg-zinc-100">
            <WifiOff className="size-5 text-zinc-400" />
          </span>
          <p className="text-[15px] font-semibold text-zinc-900">Connecting…</p>
          <p className="text-[13px] text-zinc-500">Establishing Socket.IO through this site&apos;s origin.</p>
        </>
      )}
    </div>
  )
}

const CATEGORIES = ["all", "upload", "asset", "media", "library", "job", "activity", "plex"] as const

function subscribeSocketMeta() {
  return () => {}
}

function ConnectionHub({
  connected,
  socketUrl,
  socketCrossOrigin,
  displayTotal,
  paused,
  bufferedCount,
  lastEventAt,
  onPause,
  onClear,
}: {
  connected: boolean
  socketUrl: string
  socketCrossOrigin: boolean
  displayTotal: number
  paused: boolean
  bufferedCount: number
  lastEventAt?: string
  onPause: () => void
  onClear: () => void
}) {
  const tiles = [
    { label: "Transport", value: "Socket.IO" },
    { label: "Event types", value: String(socketEventTypes.length) },
    { label: "Path", value: "/socket.io" },
    { label: "Received", value: displayTotal.toLocaleString() },
  ]

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-100 bg-zinc-50/80 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              connected ? "bg-emerald-600" : "bg-zinc-400",
            )}
            aria-hidden
          />
          <span className="text-sm font-semibold text-zinc-900">
            {connected ? "Connected" : "Connecting…"}
          </span>
        </div>

        <span className="min-w-0 truncate font-mono text-[12px] text-zinc-500">{socketUrl}</span>

        <span className="hidden text-[11px] font-medium uppercase tracking-wider text-zinc-400 sm:inline">
          Session cookie · instance feed
        </span>

        {lastEventAt ? (
          <span className="hidden items-center gap-1 text-[11px] text-zinc-500 lg:inline-flex">
            <Activity className="size-3" />
            Last {relTime(lastEventAt)}
          </span>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {paused && bufferedCount > 0 ? (
            <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
              {bufferedCount} buffered
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPause}
            className={cn(
              "h-8 gap-1.5 rounded-lg border-zinc-200 bg-white text-[12px] font-semibold",
              paused && "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
            )}
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClear}
            className="h-8 gap-1.5 rounded-lg border-zinc-200 bg-white text-[12px] font-semibold text-zinc-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </div>
      </div>

      {socketCrossOrigin && (
        <p className="border-b border-zinc-100 bg-amber-50 px-4 py-2 text-[11px] text-amber-900 sm:px-5">
          NEXT_PUBLIC_SOCKET_URL points off-origin — clear it so session cookies authenticate.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4 sm:px-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              {tile.label}
            </p>
            <p className="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums text-zinc-900">
              {tile.value}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

export function EventsMonitor() {
  const socketConnected = useSocketStore((s) => s.connected)
  const lastEventAt = useSocketStore((s) => s.lastEventAt)
  const feedEvents = useEventsFeedStore((s) => s.events)
  const feedTotal = useEventsFeedStore((s) => s.total)
  const clearFeed = useEventsFeedStore((s) => s.clear)

  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState<string>("all")
  const [displayEvents, setDisplayEvents] = useState<LiveSocketEvent[]>([])
  const [displayTotal, setDisplayTotal] = useState(0)
  const [bufferedCount, setBufferedCount] = useState(0)

  const socketUrl = useSyncExternalStore(
    subscribeSocketMeta,
    () => getClientSocketUrl(),
    () => getSocketUrlSsrDefault(),
  )
  const socketCrossOrigin = useSyncExternalStore(
    subscribeSocketMeta,
    () => new URL(getClientSocketUrl()).origin !== window.location.origin,
    () => false,
  )

  const pausedRef = useRef(false)
  const bufferRef = useRef<LiveSocketEvent[]>([])
  const seenUidsRef = useRef(new Set<string>())

  useEffect(() => {
    if (pausedRef.current) {
      for (const event of feedEvents) {
        if (seenUidsRef.current.has(event._uid)) continue
        seenUidsRef.current.add(event._uid)
        bufferRef.current.unshift(event)
      }
      setBufferedCount(bufferRef.current.length)
      return
    }

    const next: LiveSocketEvent[] = []
    for (const event of feedEvents) {
      if (seenUidsRef.current.has(event._uid)) continue
      seenUidsRef.current.add(event._uid)
      next.push(event)
    }
    if (next.length > 0) {
      setDisplayEvents((prev) => [...next, ...prev].slice(0, MAX_EVENTS))
    }
    setDisplayTotal(feedTotal)
  }, [feedEvents, feedTotal])

  function togglePause() {
    const next = !paused
    pausedRef.current = next
    if (!next) {
      const buffered = bufferRef.current.splice(0)
      setDisplayEvents((prev) => [...buffered, ...prev].slice(0, MAX_EVENTS))
      setBufferedCount(0)
      seenUidsRef.current.clear()
      for (const e of feedEvents) seenUidsRef.current.add(e._uid)
    }
    setPaused(next)
  }

  function clear() {
    clearFeed()
    setDisplayEvents([])
    bufferRef.current = []
    setDisplayTotal(0)
    setBufferedCount(0)
    seenUidsRef.current.clear()
  }

  const filtered = filter === "all" ? displayEvents : displayEvents.filter((e) => cat(e.type) === filter)

  return (
    <div className="space-y-5">
      <ConnectionHub
        connected={socketConnected}
        socketUrl={socketUrl}
        socketCrossOrigin={socketCrossOrigin}
        displayTotal={displayTotal}
        paused={paused}
        bufferedCount={bufferedCount}
        lastEventAt={lastEventAt}
        onPause={togglePause}
        onClear={clear}
      />

      <div className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 bg-zinc-50/80 px-4 py-3 sm:px-5">
          <Radio className="size-4 text-primary" />
          <span className="text-sm font-semibold text-zinc-900">Event stream</span>
          <span className="text-[11px] text-zinc-500">
            {filtered.length} shown
            {filter !== "all" ? ` · ${filter}.*` : ""}
          </span>
        </div>

        <div className="border-b border-zinc-100 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map((c) => {
              const count =
                c === "all" ? displayEvents.length : displayEvents.filter((e) => cat(e.type) === c).length
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setFilter(c)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-[12px] font-semibold capitalize transition-colors",
                    filter === c
                      ? "border-primary/35 bg-primary/10 text-primary shadow-sm"
                      : "border-transparent bg-zinc-100/80 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                  )}
                >
                  {c}
                  {count > 0 && (
                    <span
                      className={cn(
                        "ml-1.5 rounded-md px-1.5 py-0.5 text-[10px] tabular-nums",
                        filter === c ? "bg-primary/15 text-primary" : "bg-white text-zinc-500",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="space-y-2 p-4 sm:p-5">
          {paused && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] font-medium text-amber-800">
              Stream paused — {bufferedCount} new event{bufferedCount !== 1 ? "s" : ""} buffered. Click Resume to
              flush.
            </div>
          )}

          {filtered.length === 0 ? (
            <EmptyState connected={socketConnected} filter={filter} lastEventAt={lastEventAt} />
          ) : (
            filtered.map((event) => <EventCard key={event._uid} event={event} />)
          )}
        </div>
      </div>

      <details className="group overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm">
        <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-5 py-4 hover:bg-zinc-50/80">
          <div className="flex items-center gap-2">
            <Radio className="size-4 text-primary" />
            <span className="text-sm font-semibold text-zinc-900">Event type reference</span>
            <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-semibold text-zinc-500">
              {socketEventTypes.length} types
            </span>
          </div>
          <ChevronDown className="size-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-zinc-100 bg-zinc-50/40 px-5 py-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {socketEventTypes.map((t) => (
              <div
                key={t}
                className="flex items-center gap-2 rounded-xl border border-zinc-200/80 bg-white px-3 py-2 shadow-sm"
              >
                <span className="size-1.5 shrink-0 rounded-full bg-primary/70" />
                <span className="font-mono text-[12px] text-zinc-700">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </details>
    </div>
  )
}
