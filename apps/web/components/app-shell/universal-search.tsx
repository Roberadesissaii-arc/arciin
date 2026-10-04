"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Dialog as DialogPrimitive } from "radix-ui"
import {
  ArrowRight,
  Clock,
  CornerDownLeft,
  Folder,
  FolderLock,
  FolderOpen,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { normalizeUniversalQuery, rankNavigation } from "@arciin/shared"

import {
  developerNavigation,
  operationsNavigation,
  primaryNavigation,
  systemNavigation,
} from "@/components/app-shell/navigation"
import { LibrarySlugIcon } from "@/components/libraries/library-slug-icon"
import { MediaTypeIcon } from "@/components/libraries/media-type-icon"
import {
  universalSearch,
  universalSearchFiles,
  type UniversalFileResult,
  type UniversalFolderResult,
  type UniversalLibraryResult,
} from "@/lib/api/search"
import { queryKeys } from "@/lib/api/query-keys"
import { useUiStore } from "@/lib/stores/ui-store"
import {
  allFilesSearchHref,
  fileContainerHref,
  fileContextLine,
  fileDisplayTitle,
  fileHasThumbnail,
  fileHref,
  folderHref,
  formatDuration,
  libraryHref,
} from "@/lib/universal-search-routes"
import type { LibraryKind, MediaType } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/** Remote search waits this long after the last keystroke. */
const DEBOUNCE_MS = 200
const RECENT_KEY = "arciin.universal-search.recent.v1"
const RECENT_MAX = 5

type NavEntry = { title: string; href: string; icon: LucideIcon; keywords?: readonly string[]; section: string }

const NAV_KEYWORDS: Record<string, readonly string[]> = {
  "/dashboard": ["home", "dashboard", "overview"],
  "/chat": ["assistant", "ai", "ask"],
  "/files": ["all files", "browse"],
  "/models": ["ollama", "ai", "semantic", "embedding"],
  "/database": ["folders", "storage audit", "tables"],
  "/notifications": ["alerts", "inbox", "unread"],
  "/settings": ["preferences", "configuration", "updates"],
  "/settings/storage": ["disk", "space", "volumes"],
  "/security": ["mfa", "sessions", "2fa"],
  "/developer/api-keys": ["tokens", "keys"],
  "/integrations": ["plex", "connections"],
  "/activity": ["history", "events", "audit"],
}

/** Every page the sidebar reaches, plus a few settings pages it does not. */
function buildNavigation(): NavEntry[] {
  const groups: Array<[string, typeof primaryNavigation]> = [
    ["Navigation", primaryNavigation],
    ["Operations", operationsNavigation],
    ["Developer", developerNavigation],
    ["System", systemNavigation],
  ]
  const extra: NavEntry[] = [
    { title: "Uploads", href: "/uploads", icon: FolderOpen, section: "Operations", keywords: ["queue", "transfers"] },
    { title: "Remote access", href: "/settings/remote-access", icon: ArrowRight, section: "Settings", keywords: ["tunnel", "domain", "websockets"] },
    { title: "Domain", href: "/settings/domain", icon: ArrowRight, section: "Settings", keywords: ["custom domain", "dns"] },
    { title: "Docs", href: "/docs", icon: ArrowRight, section: "Help", keywords: ["documentation", "help", "manual"] },
  ]
  const out: NavEntry[] = []
  const seen = new Set<string>()
  for (const [section, items] of groups) {
    for (const item of items) {
      if (seen.has(item.href)) continue
      seen.add(item.href)
      out.push({ title: item.title, href: item.href, icon: item.icon, section, keywords: NAV_KEYWORDS[item.href] })
    }
  }
  for (const item of extra) {
    if (!seen.has(item.href)) {
      seen.add(item.href)
      out.push(item)
    }
  }
  return out
}

const NAVIGATION = buildNavigation()
const SUGGESTED_HREFS = ["/dashboard", "/files", "/chat", "/models", "/database", "/settings"]

const NO_FILES: UniversalFileResult[] = []
const NO_FOLDERS: UniversalFolderResult[] = []
const NO_LIBRARIES: UniversalLibraryResult[] = []

type RecentEntry = { kind: "file" | "folder" | "library" | "nav"; key: string; title: string; subtitle?: string; href: string }

/** Recent destinations are a per-browser convenience; storage may be unavailable. */
function readRecent(): RecentEntry[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed)
      ? parsed
          .filter((e): e is RecentEntry => Boolean(e && typeof e === "object" && typeof (e as RecentEntry).href === "string" && (e as RecentEntry).href.startsWith("/")))
          .slice(0, RECENT_MAX)
      : []
  } catch {
    return []
  }
}

function pushRecent(entry: RecentEntry) {
  try {
    const next = [entry, ...readRecent().filter((e) => e.key !== entry.key)].slice(0, RECENT_MAX)
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* private mode or blocked storage: nothing to remember */
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return debounced
}

type Row = {
  key: string
  group: string
  label: string
  /** Screen-reader text for the whole row. */
  aria: string
  href: string
  recent?: RecentEntry
  /** Shift+Enter, and the row's secondary button. */
  secondary?: { label: string; href: string }
  render: (active: boolean) => ReactNode
}

function SearchThumb({ file }: { file: UniversalFileResult }) {
  const [failed, setFailed] = useState(false)
  const showImage = fileHasThumbnail(file) && !failed
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-zinc-200/80 bg-zinc-50 text-zinc-500">
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin API thumbnail, sized by CSS
        <img
          src={`/api/assets/${encodeURIComponent(file.id)}/thumbnail?v=${encodeURIComponent(file.updatedAt)}`}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <MediaTypeIcon
          mediaType={file.mediaType as MediaType}
          filename={file.originalFilename}
          mimeType={file.mimeType}
          extension={file.extension}
          className="size-[18px]"
        />
      )}
    </span>
  )
}

function IconTile({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200/80 bg-white text-zinc-600">
      {children}
    </span>
  )
}

function RowBody({
  leading,
  title,
  subtitle,
  trailing,
}: {
  leading: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-zinc-900">{title}</span>
        {subtitle ? <span className="mt-0.5 block truncate text-xs text-zinc-600">{subtitle}</span> : null}
      </span>
      {trailing}
    </>
  )
}

function semanticStatusLine(
  semantic: "used" | "disabled" | "unavailable" | "not_indexed" | undefined,
  index: { indexed: number; eligible: number } | null | undefined,
): string | null {
  if (semantic === "unavailable") return "Semantic search unavailable — showing name matches"
  if (semantic === "not_indexed") return "Semantic index still building — showing name matches"
  if (semantic === "used" && index && index.eligible > 0) {
    return `Semantic index building · ${index.indexed.toLocaleString()} / ${index.eligible.toLocaleString()} indexed`
  }
  return null
}

function UniversalSearchPanel({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const listId = useId()
  const [input, setInput] = useState("")
  // The panel only renders in the browser (the dialog is closed on the server).
  const [recent] = useState<RecentEntry[]>(() => (typeof window === "undefined" ? [] : readRecent()))
  const listRef = useRef<HTMLDivElement>(null)

  const query = normalizeUniversalQuery(input)
  // The highlighted row belongs to a query: a new query starts at the top.
  const [cursor, setCursor] = useState<{ query: string; index: number }>({ query: "", index: 0 })
  const active = cursor.query === query ? cursor.index : 0
  const setActive = useCallback(
    (next: number | ((current: number) => number)) =>
      setCursor((prev) => {
        const current = prev.query === query ? prev.index : 0
        return { query, index: typeof next === "function" ? next(current) : next }
      }),
    [query],
  )
  const debounced = useDebounced(query, DEBOUNCE_MS)
  const remoteEnabled = debounced.length > 0

  // Changing the key drops the old query's only observer; TanStack Query then
  // aborts its fetch through `signal`, so a stale request never lands late.
  const quick = useQuery({
    queryKey: queryKeys.universalSearch(debounced),
    queryFn: ({ signal }) => universalSearch(debounced, signal),
    enabled: remoteEnabled,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  })
  const hybrid = useQuery({
    queryKey: queryKeys.universalSearchFiles(debounced),
    queryFn: ({ signal }) => universalSearchFiles(debounced, signal),
    enabled: remoteEnabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })

  const quickData = remoteEnabled ? quick.data : undefined
  const hybridFresh = remoteEnabled && hybrid.data && !hybrid.isPlaceholderData ? hybrid.data : undefined
  // Keyword files arrive first; the hybrid list replaces them once meaning is in.
  const files: UniversalFileResult[] = hybridFresh?.files ?? quickData?.files ?? NO_FILES
  const folders: UniversalFolderResult[] = quickData?.folders ?? NO_FOLDERS
  const libraries: UniversalLibraryResult[] = quickData?.libraries ?? NO_LIBRARIES
  const navigation = useMemo(
    () =>
      query
        ? rankNavigation(query, NAVIGATION)
        : SUGGESTED_HREFS.map((href) => NAVIGATION.find((n) => n.href === href)).filter((n): n is NavEntry => Boolean(n)),
    [query],
  )

  const searching = remoteEnabled && (quick.isFetching || debounced !== query)
  const meaningPending = remoteEnabled && hybrid.isFetching && !hybridFresh
  const statusLine = semanticStatusLine(hybridFresh?.semantic, hybridFresh?.index)

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    if (!query) {
      for (const entry of recent) {
        out.push({
          key: `recent:${entry.key}`,
          group: "Recent",
          label: entry.title,
          aria: `${entry.title}${entry.subtitle ? `, ${entry.subtitle}` : ""}`,
          href: entry.href,
          recent: entry,
          render: () => (
            <RowBody
              leading={
                <IconTile>
                  <Clock className="size-4" aria-hidden />
                </IconTile>
              }
              title={entry.title}
              subtitle={entry.subtitle}
            />
          ),
        })
      }
    }

    for (const file of files) {
      const title = fileDisplayTitle(file)
      const context = fileContextLine(file)
      const duration = formatDuration(file.durationSeconds)
      const subtitle = [context, duration].filter(Boolean).join(" · ")
      const href = fileHref(file)
      out.push({
        key: `file:${file.id}`,
        group: "Files",
        label: title,
        aria: [title, subtitle, file.match.label].filter(Boolean).join(", "),
        href,
        recent: { kind: "file", key: `file:${file.id}`, title, subtitle: context, href },
        secondary: { label: file.folder ? "Reveal in folder" : "Open library", href: fileContainerHref(file) },
        render: (isActive) => (
          <RowBody
            leading={<SearchThumb file={file} />}
            title={title}
            subtitle={
              <>
                {subtitle}
                {file.match.label ? (
                  <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-violet-700">
                    <Sparkles className="size-3" aria-hidden />
                    {file.match.label}
                  </span>
                ) : null}
              </>
            }
            trailing={
              <button
                type="button"
                tabIndex={-1}
                aria-label={file.folder ? `Reveal ${title} in folder` : `Open the library containing ${title}`}
                title={file.folder ? "Reveal in folder" : "Open library"}
                onClick={(event) => {
                  event.stopPropagation()
                  router.push(fileContainerHref(file))
                  onClose()
                }}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-opacity hover:bg-zinc-100 hover:text-zinc-800",
                  isActive ? "opacity-100" : "opacity-0 group-hover/row:opacity-100",
                )}
              >
                <FolderOpen className="size-4" aria-hidden />
              </button>
            }
          />
        ),
      })
    }
    if (query && files.length > 0) {
      const href = allFilesSearchHref(query)
      out.push({
        key: "files:all",
        group: "Files",
        label: "View all results",
        aria: `View all file results for ${query}`,
        href,
        render: () => (
          <span className="flex w-full items-center gap-2 pl-[3.25rem] text-xs font-medium text-zinc-600">
            View all results in All Files
            <ArrowRight className="size-3.5" aria-hidden />
          </span>
        ),
      })
    }

    for (const folder of folders) {
      const href = folderHref(folder)
      const subtitle = `${folder.library.name}${folder.assetCount ? ` · ${folder.assetCount.toLocaleString()} ${folder.assetCount === 1 ? "file" : "files"}` : ""}`
      out.push({
        key: `folder:${folder.id}`,
        group: "Folders",
        label: folder.name,
        aria: `${folder.name}, folder in ${folder.library.name}${folder.isLocked ? ", locked" : ""}`,
        href,
        recent: { kind: "folder", key: `folder:${folder.id}`, title: folder.name, subtitle: folder.library.name, href },
        render: () => (
          <RowBody
            leading={<IconTile>{folder.isLocked ? <FolderLock className="size-4" aria-hidden /> : <Folder className="size-4" aria-hidden />}</IconTile>}
            title={folder.name}
            subtitle={subtitle}
          />
        ),
      })
    }

    for (const library of libraries) {
      const href = libraryHref(library.slug)
      out.push({
        key: `library:${library.id}`,
        group: "Libraries",
        label: library.name,
        aria: `${library.name} library`,
        href,
        recent: { kind: "library", key: `library:${library.id}`, title: library.name, subtitle: "Library", href },
        render: () => (
          <RowBody
            leading={
              <IconTile>
                <LibrarySlugIcon slug={library.slug} kind={library.kind as LibraryKind} className="size-4" />
              </IconTile>
            }
            title={library.name}
            subtitle="Library"
          />
        ),
      })
    }

    for (const nav of navigation) {
      const Icon = nav.icon
      out.push({
        key: `nav:${nav.href}`,
        group: query ? "Navigation" : "Suggested",
        label: nav.title,
        aria: `${nav.title}, ${nav.section}`,
        href: nav.href,
        recent: { kind: "nav", key: `nav:${nav.href}`, title: nav.title, subtitle: nav.section, href: nav.href },
        render: () => (
          <RowBody
            leading={
              <IconTile>
                <Icon className="size-4" aria-hidden />
              </IconTile>
            }
            title={nav.title}
            subtitle={nav.section}
          />
        ),
      })
    }
    return out
  }, [query, recent, files, folders, libraries, navigation, router, onClose])

  const safeActive = rows.length ? Math.min(active, rows.length - 1) : -1

  useEffect(() => {
    if (safeActive < 0) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${safeActive}"]`)
    node?.scrollIntoView({ block: "nearest" })
  }, [safeActive])

  const go = useCallback(
    (row: Row, secondary = false) => {
      const href = secondary && row.secondary ? row.secondary.href : row.href
      if (row.recent && !secondary) pushRecent(row.recent)
      router.push(href)
      onClose()
    },
    [router, onClose],
  )

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((i) => (rows.length ? (Math.min(i, rows.length - 1) + 1) % rows.length : 0))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((i) => (rows.length ? (Math.min(i, rows.length - 1) - 1 + rows.length) % rows.length : 0))
    } else if (event.key === "Home" && event.ctrlKey) {
      event.preventDefault()
      setActive(0)
    } else if (event.key === "End" && event.ctrlKey) {
      event.preventDefault()
      setActive(Math.max(0, rows.length - 1))
    } else if (event.key === "Enter") {
      const row = safeActive >= 0 ? rows[safeActive] : undefined
      if (row) {
        event.preventDefault()
        go(row, event.shiftKey)
      } else if (query) {
        event.preventDefault()
        router.push(allFilesSearchHref(query))
        onClose()
      }
    }
  }

  const groups = useMemo(() => {
    const out: Array<{ name: string; rows: Array<{ row: Row; index: number }> }> = []
    rows.forEach((row, index) => {
      const last = out[out.length - 1]
      if (last && last.name === row.group) last.rows.push({ row, index })
      else out.push({ name: row.group, rows: [{ row, index }] })
    })
    return out
  }, [rows])

  const activeRow = safeActive >= 0 ? rows[safeActive] : undefined
  const noResults = Boolean(query) && !searching && !quick.isError && rows.length === 0
  const resultCount = rows.filter((r) => r.key !== "files:all").length

  return (
    <div className="flex max-h-[min(72dvh,640px)] min-h-0 flex-col max-sm:max-h-[calc(100dvh-1rem)]">
      <div className="flex items-center gap-3 border-b border-zinc-200/80 px-4">
        {searching ? (
          <Loader2 className="size-[18px] shrink-0 animate-spin text-zinc-400 motion-reduce:animate-none" aria-hidden />
        ) : (
          <Search className="size-[18px] shrink-0 text-zinc-400" aria-hidden />
        )}
        <input
          autoFocus
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search files, folders, libraries and pages"
          className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-zinc-900 outline-none placeholder:text-zinc-500"
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeRow ? `${listId}-${safeActive}` : undefined}
          aria-label="Search Arciin"
          spellCheck={false}
          autoComplete="off"
        />
        <kbd className="hidden shrink-0 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 sm:inline">
          Esc
        </kbd>
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Search results"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2"
      >
        {groups.map((group) => (
          <div key={group.name} role="group" aria-labelledby={`${listId}-g-${group.name}`} className="pb-1.5 last:pb-0">
            <div
              id={`${listId}-g-${group.name}`}
              className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500"
            >
              {group.name}
              {group.name === "Files" && meaningPending ? (
                <span className="flex items-center gap-1 font-normal normal-case tracking-normal text-zinc-400">
                  <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
                  finding matches by meaning
                </span>
              ) : null}
            </div>
            {group.rows.map(({ row, index }) => {
              const isActive = index === safeActive
              return (
                <div
                  key={row.key}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={isActive}
                  aria-label={row.aria}
                  data-row-index={index}
                  onMouseMove={() => {
                    if (!isActive) setActive(index)
                  }}
                  onClick={() => go(row)}
                  className={cn(
                    "group/row relative flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors motion-reduce:transition-none",
                    isActive ? "bg-orange-50 ring-1 ring-inset ring-orange-200/80" : "hover:bg-zinc-50",
                  )}
                >
                  {isActive ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[#FF4F12]" aria-hidden /> : null}
                  {row.render(isActive)}
                </div>
              )
            })}
          </div>
        ))}

        {!query && rows.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-zinc-600">Type to search files, folders and pages.</p>
        ) : null}
        {noResults ? (
          <div className="px-3 py-8 text-center" role="status">
            <p className="text-sm font-medium text-zinc-800">No results for “{query}”</p>
            <p className="mt-1 text-xs text-zinc-600">Try another name, or a few words describing the file.</p>
          </div>
        ) : null}
        {query && quick.isError ? (
          <p className="px-3 py-4 text-center text-xs text-red-700" role="alert">
            Search is unavailable right now. Pages are still listed.
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-zinc-200/80 bg-zinc-50/70 px-4 py-2 text-[11px] text-zinc-600">
        <span role="status" aria-live="polite" className="min-w-0 truncate">
          {statusLine ?? (query && !searching ? `${resultCount} ${resultCount === 1 ? "result" : "results"}` : "")}
        </span>
        <span className="hidden items-center gap-3 sm:flex">
          <span>↑↓ to move</span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="size-3" aria-hidden /> to open
          </span>
          {activeRow?.secondary ? <span>⇧↵ {activeRow.secondary.label.toLowerCase()}</span> : null}
        </span>
      </div>
    </div>
  )
}

/**
 * The top search box: one surface for files (with matches by meaning),
 * folders, libraries and pages. Cmd/Ctrl+K toggles it from anywhere.
 */
export function UniversalSearchDialog() {
  const open = useUiStore((state) => state.commandOpen)
  const setOpen = useUiStore((state) => state.setCommandOpen)
  const close = useCallback(() => setOpen(false), [setOpen])
  /** Whatever had focus when search opened — usually the search chip — gets it back on close. */
  const returnFocus = useRef<HTMLElement | null>(null)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-zinc-950/25 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content
          className={cn(
            "dashboard-main fixed left-1/2 top-[max(0.5rem,11vh)] z-50 w-[min(680px,calc(100vw-1rem))] -translate-x-1/2 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/95 text-foreground shadow-[0_24px_80px_-24px_rgba(0,0,0,0.35),0_0_0_1px_rgba(0,0,0,0.04)] backdrop-blur-2xl outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 motion-reduce:animate-none",
          )}
          data-testid="universal-search"
          onOpenAutoFocus={() => {
            const current = document.activeElement
            returnFocus.current = current instanceof HTMLElement && current !== document.body ? current : null
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target =
              returnFocus.current?.isConnected
                ? returnFocus.current
                : document.querySelector<HTMLElement>('[data-testid="universal-search-trigger"]')
            target?.focus({ preventScroll: true })
            returnFocus.current = null
          }}
        >
          <DialogPrimitive.Title className="sr-only">Search Arciin</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search files, folders, libraries and pages. Use the arrow keys to move through results, Enter to open, Escape to close.
          </DialogPrimitive.Description>
          {open ? <UniversalSearchPanel onClose={close} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

