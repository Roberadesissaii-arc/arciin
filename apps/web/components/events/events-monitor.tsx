"use client"

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  Activity,
  ChevronDown,
  Pause,
  Play,
  Radio,
  Search,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react"

import { AppPagination } from "@/components/ui/app-pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  dashboardTableBodyRow,
  dashboardTableHeadCell,
  dashboardTableHeadRow,
  dashboardTablePagination,
  dashboardTablePanel,
  dashboardTablePanelHeader,
} from "@/lib/dashboard-table-styles"
import { cn } from "@/lib/utils"
import { getClientSocketUrl, getSocketUrlSsrDefault } from "@/lib/realtime/client-socket-url"
import { useEventsFeedStore, type LiveSocketEvent } from "@/lib/stores/events-feed-store"
import { useSocketStore } from "@/lib/stores/socket-store"
import { socketEventTypes } from "@/lib/types/events"

const MAX_EVENTS = 300
/** Match Activity log page size. */
const PAGE_SIZE = 10

/** Same solid accent chip as Activity — fixed width so long names don't stretch. */
const typeBadgeClass =
  "inline-flex h-7 w-[6.5rem] shrink-0 justify-center truncate rounded-md border-0 bg-primary px-2.5 text-[11px] font-bold uppercase tracking-wide text-primary-foreground shadow-none"

const TYPE_LABELS: Record<string, string> = {
  upload: "Upload",
  asset: "Asset",
  thumbnail: "Thumb",
  media: "Media",
  library: "Library",
  job: "Job",
  activity: "Activity",
  plex: "Plex",
}

/** Soft category dots — same pattern as All Files badge filter. */
const CATEGORY_DOT: Record<string, string> = {
  all: "bg-zinc-400",
  upload: "bg-blue-500",
  asset: "bg-violet-500",
  thumbnail: "bg-orange-500",
  media: "bg-orange-500",
  library: "bg-emerald-500",
  job: "bg-amber-500",
  activity: "bg-zinc-500",
  plex: "bg-yellow-500",
}

function CategoryDot({ category }: { category: string }) {
  return (
    <span
      className={cn(
        "size-2.5 shrink-0 rounded-full ring-1 ring-black/10",
        CATEGORY_DOT[category] ?? "bg-zinc-400",
      )}
      aria-hidden
    />
  )
}

function categoryLabel(category: string) {
  if (category === "all") return "All types"
  return TYPE_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1)
}

function cat(type: string) {
  return type.split(".")[0] ?? "activity"
}

function typeLabel(type: string) {
  const category = cat(type)
  return TYPE_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1)
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 1000) return "just now"
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  return new Date(iso).toLocaleTimeString()
}

/** Full event line — message preferred, else last segment of type. */
function eventLabel(event: LiveSocketEvent): string {
  const message = event.message?.trim()
  if (message) return message
  const parts = event.type.split(".")
  return parts.slice(1).join(".") || event.type
}

/** Fixed short preview so every Event cell stays the same length. */
const EVENT_PREVIEW_MAX = 32

function eventLabelPreview(label: string): string {
  if (label.length <= EVENT_PREVIEW_MAX) return label
  return `${label.slice(0, EVENT_PREVIEW_MAX).trimEnd()}…`
}

/** Minimal details cell — only progress when present; rest is in the expand row. */
function eventDetailsPreview(event: LiveSocketEvent): string | null {
  if (typeof event.progress === "number") return `${event.progress}%`
  return null
}

function eventSubject(event: LiveSocketEvent): string | null {
  if (event.assetId) return "Asset"
  if (event.uploadId) return "Upload"
  if (event.jobId) return "Job"
  if (event.libraryId) return "Library"
  if (event.userId) return "User"
  return typeLabel(event.type)
}

function eventPayload(event: LiveSocketEvent) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _rxAt, _uid: _uid_, ...payload } = event
  return payload
}

function EventTableRow({ event }: { event: LiveSocketEvent }) {
  const [open, setOpen] = useState(false)
  const details = eventDetailsPreview(event)
  const subject = eventSubject(event)
  const label = eventLabel(event)
  const preview = eventLabelPreview(label)

  return (
    <Fragment>
      <TableRow
        className={cn(
          dashboardTableBodyRow,
          "cursor-pointer [&>td]:align-middle [&>td]:overflow-hidden [&>td]:px-3 [&>td]:py-3.5",
        )}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <TableCell className="overflow-hidden whitespace-nowrap pl-5 text-[13px] tabular-nums text-zinc-500">
          {relTime(event._rxAt)}
        </TableCell>
        <TableCell className="overflow-hidden">
          <Badge className={typeBadgeClass} title={event.type}>
            {typeLabel(event.type)}
          </Badge>
        </TableCell>
        <TableCell className="max-w-0 overflow-hidden">
          <span
            className="block w-full min-w-0 truncate font-mono text-[12px] font-medium text-zinc-900"
            title={label}
          >
            {preview}
          </span>
        </TableCell>
        <TableCell className="max-w-0 overflow-hidden">
          <span className="block w-full min-w-0 truncate text-[13px] text-zinc-600">
            {details ?? <span className="text-zinc-400">—</span>}
          </span>
        </TableCell>
        <TableCell className="overflow-hidden whitespace-nowrap pr-5 text-right">
          <div className="inline-flex max-w-full items-center justify-end gap-2">
            <span className="truncate text-[13px] font-medium text-zinc-600">
              {subject ?? <span className="text-zinc-400">—</span>}
            </span>
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-zinc-400 transition-transform",
                open && "rotate-180",
              )}
            />
          </div>
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow className="border-border bg-zinc-50/80 hover:bg-zinc-50/80">
          <TableCell colSpan={5} className="px-5 py-3.5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-zinc-500">
                <span className="font-mono font-semibold text-zinc-700">{event.type}</span>
                {event.id ? (
                  <span className="font-mono text-zinc-400">id {event.id}</span>
                ) : null}
              </div>
              {label ? (
                <p className="text-[13px] leading-relaxed text-zinc-700">{label}</p>
              ) : null}
              <pre className="overflow-x-auto rounded-xl border border-zinc-800/40 bg-zinc-950 px-4 py-3 text-[12px] leading-relaxed text-zinc-100">
                <code>{JSON.stringify(eventPayload(event), null, 2)}</code>
              </pre>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  )
}

function EmptyState({
  connected,
  filter,
  search,
  lastEventAt,
}: {
  connected: boolean
  filter: string
  search: string
  lastEventAt?: string
}) {
  const hasQuery = search.trim().length > 0 || filter !== "all"

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {connected ? (
        <>
          <span className="relative flex size-12 items-center justify-center rounded-full bg-primary/10">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
            <Wifi className="relative size-5 text-primary" />
          </span>
          <p className="text-[15px] font-semibold tracking-tight text-zinc-900">
            {hasQuery ? "No matching events" : "Listening for events…"}
          </p>
          <p className="max-w-md text-[13px] leading-relaxed text-zinc-500">
            {hasQuery
              ? "Try another search or filter. Live events keep arriving while this page is open."
              : filter === "all"
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
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
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
    setPage(1)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return displayEvents.filter((e) => {
      if (filter !== "all" && cat(e.type) !== filter) return false
      if (!q) return true
      const haystack = [
        e.type,
        e.message,
        e.id,
        e.assetId,
        e.uploadId,
        e.jobId,
        e.libraryId,
        e.userId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [displayEvents, filter, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

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

      {/* Search + type filter between connection hub and the table */}
      <div className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm">
        <div className="flex min-h-[4.25rem] flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-3 sm:px-5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search events…"
              className="h-11 border-zinc-200 bg-white pl-10 text-[13px] text-zinc-900 shadow-none placeholder:text-zinc-400 focus-visible:border-zinc-300 focus-visible:ring-zinc-200/80"
              aria-label="Search events"
            />
          </div>
          <Select
            value={filter}
            onValueChange={(value) => {
              setFilter(value)
              setPage(1)
            }}
          >
            <SelectTrigger className="h-11 w-full border-zinc-200 bg-white text-[13px] font-semibold text-zinc-800 shadow-none focus-visible:border-zinc-300 focus-visible:ring-zinc-200/80 sm:w-[12.5rem]">
              <SelectValue placeholder="All types">
                <span className="flex items-center gap-2">
                  <CategoryDot category={filter} />
                  {categoryLabel(filter)}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent position="popper" side="bottom" align="end" sideOffset={6} className="z-[80]">
              {CATEGORIES.map((c) => {
                const count =
                  c === "all"
                    ? displayEvents.length
                    : displayEvents.filter((e) => cat(e.type) === c).length
                return (
                  <SelectItem key={c} value={c}>
                    <span className="flex items-center gap-2">
                      <CategoryDot category={c} />
                      <span>
                        {categoryLabel(c)}
                        {count > 0 ? (
                          <span className="text-muted-foreground"> ({count})</span>
                        ) : null}
                      </span>
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className={dashboardTablePanel}>
        <div className={dashboardTablePanelHeader}>
          <Radio className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Event stream</span>
          <div className="ml-auto flex items-center gap-2">
            {filtered.length > 0 ? (
              <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                {filtered.length} event{filtered.length === 1 ? "" : "s"}
                {totalPages > 1 ? ` · page ${safePage} of ${totalPages}` : ""}
              </span>
            ) : (
              <span className="text-[11px] text-muted-foreground">0 events</span>
            )}
          </div>
        </div>

        {paused ? (
          <div className="border-b border-amber-200/80 bg-amber-50 px-5 py-2.5 text-[12px] font-medium text-amber-800">
            Stream paused — {bufferedCount} new event{bufferedCount !== 1 ? "s" : ""} buffered. Click Resume to
            flush.
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <EmptyState
            connected={socketConnected}
            filter={filter}
            search={search}
            lastEventAt={lastEventAt}
          />
        ) : (
          <>
            <Table className="w-full min-w-0 table-fixed">
              <colgroup>
                <col style={{ width: "14%" }} />
                <col style={{ width: "14%" }} />
                <col style={{ width: "28%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "22%" }} />
              </colgroup>
              <TableHeader>
                <TableRow className={dashboardTableHeadRow}>
                  <TableHead className={cn(dashboardTableHeadCell, "pl-5 pr-3")}>Time</TableHead>
                  <TableHead className={cn(dashboardTableHeadCell, "px-3")}>Type</TableHead>
                  <TableHead className={cn(dashboardTableHeadCell, "px-3")}>Event</TableHead>
                  <TableHead className={cn(dashboardTableHeadCell, "px-3")}>Details</TableHead>
                  <TableHead className={cn(dashboardTableHeadCell, "pl-3 pr-5 text-right")}>
                    Subject
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((event) => (
                  <EventTableRow key={event._uid} event={event} />
                ))}
              </TableBody>
            </Table>

            {totalPages > 1 ? (
              <div className={dashboardTablePagination}>
                <AppPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
              </div>
            ) : null}
          </>
        )}
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
