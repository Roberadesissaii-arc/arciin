"use client"

/**
 * Edit a video, without leaving the library.
 *
 * A right-side Sheet rather than a route: the reader is browsing Videos and
 * wants to look at one thing about one file. Sending them to a full-page
 * workspace to read a transcript loses their place in the grid.
 *
 * The transcript is the point of the panel, and its state lives on the server.
 * Generation is a queued job, so this component observes rather than owns it —
 * closing the drawer, navigating away or reloading the page must not cancel a
 * transcript that is halfway through a two-hour recording.
 */

import { useCallback, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  VolumeX,
  ChevronDown,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { toast } from "@/lib/notifications/arciin-toast"
import {
  getAssetTranscript,
  requestAssetTranscript,
  requestTranscriptTranslation,
  saveAssetTranscript,
  type TranscriptTranslation,
} from "@/lib/api/transcripts"
import { AssetOverviewDetails } from "@/components/libraries/asset-overview-content"
import { VideoAiSummarize } from "@/components/libraries/video-ai-summarize"
import { VideoAiTitle } from "@/components/libraries/video-ai-title"
import { TranscriptLanguageBar } from "@/components/libraries/transcript-language-bar"
import { VideoAssetViewer } from "@/components/libraries/video-asset-viewer"
import { cn } from "@/lib/utils"
import {
  formatTimecode,
  isTranscriptRunning,
  transcriptToPlainText,
  transcriptToSrt,
  transcriptToTimestampedText,
  type MediaTranscript,
  type TranscriptSegment,
} from "@arciin/types"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import type { AssetSummary } from "@/lib/types/models"

const transcriptKey = (assetId: string) => ["asset-transcript", assetId] as const

/** BCP-47 → a name a person recognises, with the tag as a fallback. */
function languageLabel(tag: string | null): string | null {
  if (!tag) return null
  try {
    const display = new Intl.DisplayNames(undefined, { type: "language" }).of(tag)
    if (display && display.toLowerCase() !== tag.toLowerCase()) return display
  } catch {
    /* unknown tag — show it as given */
  }
  return tag
}

/* ------------------------------------------------------------- transcript */

function TranscriptSegments({
  segments,
  query,
  activeIndex,
  onSeek,
}: {
  segments: TranscriptSegment[]
  query: string
  activeIndex: number
  onSeek: (ms: number) => void
}) {
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? segments
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => s.text.toLowerCase().includes(needle))
    : segments.map((s, i) => ({ s, i }))

  // One decision for the whole transcript, so timecodes line up in a column.
  const long = segments.some((s) => s.startMs >= 3_600_000)

  if (shown.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-muted-foreground">
        No segments match “{query}”.
      </p>
    )
  }

  // Worked out before rendering rather than with a running variable: a speaker
  // label belongs to the row, and mutating during render is exactly the pattern
  // the compiler cannot reason about.
  const rows = shown.map((entry, position) => ({
    ...entry,
    newSpeaker: Boolean(entry.s.speaker) && entry.s.speaker !== shown[position - 1]?.s.speaker,
  }))

  return (
    /**
     * Meant to be read, not scanned like a log.
     *
     * A speaker's name appears once at the top of their run rather than on every
     * line, consecutive lines from one person sit closer together than the gap
     * between speakers, and nothing is boxed — turning each sentence into a card
     * is what made the old version feel like debug output. The timestamp keeps
     * its own column so the eye can ignore it while reading and find it
     * instantly when seeking.
     */
    <ol className="mt-3" data-testid="video-transcript-segments">
      {rows.map(({ s, i, newSpeaker }) => {
        const active = i === activeIndex
        return (
          <li key={`${s.startMs}-${i}`} className={cn(newSpeaker ? "mt-4 first:mt-0" : "mt-1.5")}>
            {newSpeaker ? (
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {s.speaker}
              </p>
            ) : null}
            <div
              className={cn(
                "flex gap-2.5 rounded-md border-l-2 py-0.5 pl-2 transition-colors",
                // The playing line, marked without shouting: an accent edge and
                // the faintest wash, so following along does not turn the page
                // into a flashing list.
                active ? "border-primary/70 bg-primary/[0.06]" : "border-transparent",
              )}
              data-testid={active ? "transcript-active-segment" : undefined}
            >
              <button
                type="button"
                onClick={() => onSeek(s.startMs)}
                className={cn(
                  "mt-[3px] h-fit shrink-0 rounded px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums",
                  // A quiet pill rather than orange text: it has to read as
                  // interactive without reading as a warning.
                  "bg-muted text-muted-foreground transition-colors",
                  "hover:bg-primary/10 hover:text-primary",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                )}
                aria-label={`Jump to ${formatTimecode(s.startMs, { forceHours: long })}`}
                data-testid="transcript-timestamp"
                data-start-ms={s.startMs}
              >
                {formatTimecode(s.startMs, { forceHours: long })}
              </button>
              <p
                className={cn(
                  "min-w-0 flex-1 text-[13.5px] leading-[1.65]",
                  active ? "text-foreground" : "text-foreground/85",
                )}
              >
                {needle ? highlight(s.text, needle) : s.text}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** How many segments contain the term. Local, and never another model call. */
function countMatches(segments: { text: string }[], query: string): number {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  return segments.filter((s) => s.text.toLowerCase().includes(needle)).length
}

/** Mark the searched term without dangerouslySetInnerHTML. */
function highlight(text: string, needle: string): React.ReactNode {
  const out: React.ReactNode[] = []
  const lower = text.toLowerCase()
  let from = 0
  let k = 0
  for (;;) {
    const at = lower.indexOf(needle, from)
    if (at === -1) break
    if (at > from) out.push(text.slice(from, at))
    out.push(
      <mark key={k++} className="rounded bg-primary/20 px-0.5 text-foreground">
        {text.slice(at, at + needle.length)}
      </mark>,
    )
    from = at + needle.length
  }
  out.push(text.slice(from))
  return out
}

/* ------------------------------------------------------------------ panel */

/**
 * The video's player, details and transcript, with no shell around it.
 *
 * Split out so the unified asset panel shows the *same* transcript this drawer
 * always did — the same polling, the same persistence, the same copy/export and
 * timestamp seeking. Re-implementing it for the panel would have meant two
 * transcript UIs to keep in step, and the one users already rely on is this one.
 */
export function VideoTranscriptSection({
  asset,
  showDetails = true,
  initialTab,
}: {
  asset: AssetSummary | null
  /** False inside the asset panel, where Overview already shows all of this. */
  showDetails?: boolean
  /**
   * Where to land, when the reader asked for somewhere specific — clicking a
   * card's running-transcript indicator, rather than merely selecting the card.
   */
  initialTab?: "transcript" | "title" | "summary"
}) {
  const queryClient = useQueryClient()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [currentMs, setCurrentMs] = useState(0)

  const assetId = asset?.id ?? null

  /**
   * The server is the source of truth, and it is polled while work is running.
   *
   * Nothing here caches a finished transcript into component state: reopening
   * the drawer reads the persisted row, which is why a refresh restores it and
   * why opening the panel never re-sends media to Gemini.
   */
  const transcriptQuery = useQuery({
    queryKey: transcriptKey(assetId ?? "none"),
    queryFn: ({ signal }) => getAssetTranscript(assetId!, signal),
    enabled: Boolean(assetId),
    refetchInterval: (query) => {
      const status = query.state.data?.transcript?.status
      return status && isTranscriptRunning(status) ? 3000 : false
    },
  })

  const transcript: MediaTranscript | null = transcriptQuery.data?.transcript ?? null
  const translations: TranscriptTranslation[] = transcriptQuery.data?.translations ?? []

  /**
   * Which language is on screen. `null` is the original.
   *
   * Everything below reads from `segments`, so switching language switches what
   * search, copy, the exports and timestamp seeking all operate on — without a
   * second copy of any of them.
   */
  const [activeLanguage, setActiveLanguage] = useState<string | null>(null)
  const [aiTab, setAiTab] = useState<"transcript" | "title" | "summary">(
    initialTab ?? "transcript",
  )
  const activeTranslation = activeLanguage
    ? (translations.find((t) => t.language === activeLanguage) ?? null)
    : null

  // Memoised so the active-segment lookup below is not recomputed on every
  // render just because `?? []` produced a fresh array.
  const segments = useMemo(
    () => activeTranslation?.segments ?? transcript?.segments ?? [],
    [activeTranslation, transcript],
  )
  const running = transcript ? isTranscriptRunning(transcript.status) : false

  /**
   * Translate into one language.
   *
   * Sends nothing but a language tag: the server already holds the transcript,
   * so the video is not touched. Loading a language that already exists never
   * reaches this — it arrives with the transcript query.
   */
  const translate = useMutation({
    mutationFn: (language: string) => requestTranscriptTranslation(assetId!, { language }),
    onSuccess: (data) => {
      setActiveLanguage(data.translation.language)
      void queryClient.invalidateQueries({ queryKey: transcriptKey(assetId!) })
      toast.success("Translation ready", {
        description: `${languageLabel(data.translation.language)} is now saved with this video.`,
      })
    },
    onError: (error) => {
      toast.error("Could not translate", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      })
    },
  })

  const generate = useMutation({
    mutationFn: () => requestAssetTranscript(assetId!),
    onSuccess: (data) => {
      queryClient.setQueryData(transcriptKey(assetId!), {
        transcript: data.transcript,
        transcribable: true,
      })
      void queryClient.invalidateQueries({ queryKey: transcriptKey(assetId!) })
    },
    onError: (error) => {
      toast.error("Could not start the transcript", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      })
    },
  })

  const saveEdit = useMutation({
    mutationFn: (text: string) => {
      // The PATCH keeps the existing timings and replaces the words, so a
      // correction cannot accidentally scramble the timeline.
      const lines = text.split("\n")
      const next = segments.map((s, i) => ({ ...s, text: (lines[i] ?? s.text).trim() }))
      return saveAssetTranscript(assetId!, {
        segments: next,
        fullText: transcriptToPlainText(next),
      })
    },
    onSuccess: (data) => {
      queryClient.setQueryData(transcriptKey(assetId!), {
        transcript: data.transcript,
        transcribable: true,
      })
      setEditing(false)
      toast.success("Transcript saved")
    },
    onError: (error) => {
      toast.error("Could not save the transcript", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      })
    },
  })

  /** Which segment the playhead is inside, for the subtle active highlight. */
  const activeIndex = useMemo(() => {
    if (segments.length === 0) return -1
    let found = -1
    for (let i = 0; i < segments.length; i += 1) {
      if (segments[i]!.startMs <= currentMs) found = i
      else break
    }
    return found
  }, [segments, currentMs])

  const seekTo = useCallback((ms: number) => {
    const el = videoRef.current
    if (!el) return
    // Seek only. Starting playback because someone read a line would be a
    // surprise, especially on a shared screen.
    el.currentTime = ms / 1000
    setCurrentMs(ms)
  }, [])

  /**
   * Leaving the drawer resets view state — never the job.
   *
   * Done on the close event rather than in an effect watching `open`: setting
   * state inside an effect triggers a second render pass, and the reset is a
   * consequence of the user closing the panel, not of a value changing.
   */

  const copy = async (withTimestamps: boolean) => {
    const text = withTimestamps
      ? transcriptToTimestampedText(segments)
      : transcriptToPlainText(segments)
    try {
      await navigator.clipboard.writeText(text)
      toast.success(withTimestamps ? "Copied with timestamps" : "Transcript copied")
    } catch {
      toast.error("Could not copy", { description: "Your browser blocked clipboard access." })
    }
  }

  const download = (kind: "txt" | "srt") => {
    if (!asset) return
    const body = kind === "srt" ? transcriptToSrt(segments) : transcriptToPlainText(segments)
    const base = asset.originalFilename.replace(/\.[^.]+$/, "")
    const blob = new Blob([body], {
      type: kind === "srt" ? "application/x-subrip" : "text/plain;charset=utf-8",
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${base}-transcript.${kind}`
    a.click()
    URL.revokeObjectURL(url)
  }

  const startGenerate = () => {
    if (transcript?.edited && transcript.status === "READY") {
      const ok = window.confirm(
        "Regenerating will replace your edited transcript. Continue?",
      )
      if (!ok) return
    }
    generate.mutate()
  }

  if (!asset) return null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
            {/* The library's own player, lent a ref so the transcript can seek it. */}
            <div className="mt-4 w-full" data-testid="video-edit-player">
              <VideoAssetViewer
                src={`/api/assets/${asset.id}/download?inline=1&v=${encodeURIComponent(asset.updatedAt)}`}
                mediaRef={videoRef}
                onTimeChange={(seconds) => setCurrentMs(seconds * 1000)}
                compact
                controlsBelow
              />
            </div>

            {/*
              Same Details table as Overview — one source of truth for both
              surfaces. Hidden inside the asset panel, where Overview already
              shows it above the AI tools.
            */}
            {showDetails ? (
              <AssetOverviewDetails asset={asset} className="mt-4" />
            ) : null}

            {/* Transcript / Title / Summarize — three jobs on the same text. */}
            <div className="mt-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                AI tools
              </p>
              <nav
                className="mt-2 flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1"
                aria-label="Video AI sections"
                data-testid="video-ai-nav"
              >
                {(
                  [
                    ["transcript", "Transcript"],
                    ["title", "Title"],
                    ["summary", "Summarize"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAiTab(key)}
                    aria-current={aiTab === key ? "page" : undefined}
                    data-testid={`video-ai-tab-${key}`}
                    className={cn(
                      "flex-1 rounded-lg px-2 py-2 text-center text-[12px] font-semibold transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                      aiTab === key
                        ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200/80"
                        : "text-zinc-500 hover:text-zinc-800",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            </div>

            {aiTab === "title" ? (
              <VideoAiTitle
                asset={asset}
                hasTranscript={Boolean(transcript && transcript.status === "READY")}
                onGenerateTranscript={() => {
                  startGenerate()
                  setAiTab("transcript")
                }}
                transcriptRunning={running || generate.isPending}
              />
            ) : null}

            {aiTab === "summary" ? (
              <VideoAiSummarize
                asset={asset}
                hasTranscript={Boolean(transcript && transcript.status === "READY")}
                transcriptStatus={transcript?.status ?? null}
                onGenerateTranscript={startGenerate}
                transcriptRunning={running || generate.isPending}
              />
            ) : null}

            <div
              className={cn("mt-1", aiTab !== "transcript" && "hidden")}
              data-testid="video-transcript"
            >
              {/* Only once there is something to translate. */}
              {transcript && transcript.status === "READY" ? (
                <TranscriptLanguageBar
                  sourceLanguage={transcript.language}
                  translations={translations}
                  activeLanguage={activeLanguage}
                  onSelect={setActiveLanguage}
                  onTranslate={(language) => translate.mutate(language)}
                  translating={translate.isPending}
                  pendingLanguage={translate.variables ?? null}
                />
              ) : null}
              <TranscriptBody
                transcript={transcript}
                loading={transcriptQuery.isLoading}
                running={running}
                starting={generate.isPending}
                segments={segments}
                search={search}
                onSearch={setSearch}
                activeIndex={activeIndex}
                onSeek={seekTo}
                onGenerate={startGenerate}
                onCopy={copy}
                onDownload={download}
                editing={editing && activeLanguage === null}
                draft={draft}
                // Corrections belong to the original; a translation is derived
                // from it, so editing one would be edited away by a regenerate.
                onEditStart={
                  activeLanguage === null
                    ? () => {
                        setDraft(segments.map((s) => s.text).join("\n"))
                        setEditing(true)
                      }
                    : undefined
                }
                onDraftChange={setDraft}
                onEditCancel={() => setEditing(false)}
                onEditSave={() => saveEdit.mutate(draft)}
                saving={saveEdit.isPending}
              />
            </div>
    </div>
  )
}

/**
 * The standalone video drawer.
 *
 * Now a shell around the shared section, and wearing the same
 * `libraryGlassSheetPanel` as Edit File, Move and Share — it used to take the
 * Sheet defaults for `side="right"`, which pin a panel flush to the top, bottom
 * and right edge with square corners, so it read as a different component
 * family from everything around it.
 */
export function VideoEditDrawer({
  asset,
  open,
  onOpenChange,
}: {
  asset: AssetSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-testid="video-edit-drawer"
        className={cn(
          libraryGlassSheetPanel,
          "dashboard-main text-foreground sm:max-w-[480px]",
        )}
      >
        <SheetHeader className="relative shrink-0 space-y-1 border-b border-border px-4 py-3 pr-11">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">AI</p>
            <SheetTitle
              className="truncate text-[15px] font-semibold tracking-tight text-zinc-900"
              title={asset?.originalFilename}
            >
              {asset?.originalFilename ?? "Video"}
            </SheetTitle>
            <SheetDescription className="text-[12px] text-zinc-500">
              Transcript, title suggestions, and summarize.
            </SheetDescription>
          </div>
        </SheetHeader>
        {open ? <VideoTranscriptSection asset={asset} /> : null}
      </SheetContent>
    </Sheet>
  )
}


/* ------------------------------------------------------------- states */

function TranscriptBody(props: {
  transcript: MediaTranscript | null
  loading: boolean
  running: boolean
  starting: boolean
  segments: TranscriptSegment[]
  search: string
  onSearch: (v: string) => void
  activeIndex: number
  onSeek: (ms: number) => void
  onGenerate: () => void
  onCopy: (withTimestamps: boolean) => void
  onDownload: (kind: "txt" | "srt") => void
  editing: boolean
  draft: string
  /** Absent while a translation is on screen — corrections belong to the original. */
  onEditStart?: () => void
  onDraftChange: (v: string) => void
  onEditCancel: () => void
  onEditSave: () => void
  saving: boolean
}) {
  const { transcript, segments } = props

  if (props.loading) {
    return <p className="text-[13px] text-muted-foreground">Loading transcript…</p>
  }

  // Running. The wording follows the job, not a timer.
  if (props.running || props.starting) {
    const label =
      props.starting || transcript?.status === "PENDING"
        ? "Preparing media…"
        : "Analyzing audio with Gemini…"
    return (
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-3">
        <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-foreground">{label}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            This keeps running if you close the drawer.
          </p>
        </div>
      </div>
    )
  }

  if (transcript?.status === "NO_AUDIO") {
    return (
      <Notice icon={<VolumeX className="size-4" />} title="No audio track detected">
        This video doesn’t appear to contain audio that can be transcribed.
      </Notice>
    )
  }

  if (transcript?.status === "NO_SPEECH") {
    return (
      <Notice icon={<VolumeX className="size-4" />} title="No intelligible speech detected">
        The audio was analyzed, but no speech could be made out.
        <RetryButton onClick={props.onGenerate} />
      </Notice>
    )
  }

  if (transcript?.status === "FAILED") {
    const notConfigured = /gemini isn.?t configured|not configured/i.test(transcript.error ?? "")
    return (
      <Notice
        icon={<AlertTriangle className="size-4" />}
        title={notConfigured ? "Gemini isn’t configured" : "Transcript generation failed"}
        tone="danger"
      >
        {notConfigured ? (
          <>
            Add a Gemini model under{" "}
            <Link href="/models" className="text-primary hover:underline">
              Models
            </Link>{" "}
            to generate transcripts.
          </>
        ) : (
          <span className="break-words">{transcript.error ?? "Gemini returned an error."}</span>
        )}
        <RetryButton onClick={props.onGenerate} label="Try again" />
      </Notice>
    )
  }

  // Ready, with words in it.
  if (transcript?.status === "READY" && segments.length > 0) {
    const language = languageLabel(transcript.language)
    return (
      <div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
          {language ? <span className="text-foreground">{language}</span> : null}
          {language ? <span aria-hidden>·</span> : null}
          <span>Gemini</span>
          {transcript.generatedAt ? (
            <>
              <span aria-hidden>·</span>
              <span>
                {new Date(transcript.generatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
            </>
          ) : null}
          {transcript.edited ? (
            <span className="rounded border border-border px-1.5 py-0.5 text-[10.5px] font-medium text-foreground">
              Edited
            </span>
          ) : null}
        </div>

        {/*
          Two actions and a menu, instead of six equal buttons.

          The old row gave Copy, With times, .txt, .srt, Edit and Regenerate the
          same weight, so nothing looked more important than anything else — and
          Regenerate, which costs money and discards manual edits, sat next to
          Copy as though they were peers. Copy and Edit are what people reach for
          while reading; the rest are occasional and live behind More.
        */}
        <div className="mt-3 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-400" />
            <Input
              value={props.search}
              onChange={(e) => props.onSearch(e.target.value)}
              placeholder="Search…"
              className="h-9 rounded-xl border-zinc-200 bg-zinc-50 pl-8 pr-16 text-[13px]"
              data-testid="transcript-search"
            />
            {props.search.trim() ? (
              <span
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-zinc-400"
                data-testid="transcript-match-count"
              >
                {countMatches(segments, props.search)}
              </span>
            ) : null}
          </div>

          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-9 shrink-0 rounded-xl border-zinc-200"
            onClick={() => props.onCopy(false)}
            data-testid="transcript-copy"
            aria-label="Copy transcript"
            title="Copy"
          >
            <Copy className="size-3.5" />
          </Button>

          {!props.editing && props.onEditStart ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-9 shrink-0 rounded-xl border-zinc-200"
              onClick={props.onEditStart}
              data-testid="transcript-edit"
              aria-label="Edit transcript"
              title="Edit"
            >
              <Pencil className="size-3.5" />
            </Button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="size-9 shrink-0 rounded-xl border-zinc-200"
                data-testid="transcript-more"
                aria-label="More transcript actions"
              >
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[220] w-52">
              <DropdownMenuItem
                onSelect={() => props.onCopy(true)}
                data-testid="transcript-copy-times"
              >
                <Copy className="size-3.5" /> Copy with times
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => props.onDownload("txt")}
                data-testid="transcript-download-txt"
              >
                <Download className="size-3.5" /> Download TXT
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => props.onDownload("srt")}
                data-testid="transcript-download-srt"
              >
                <Download className="size-3.5" /> Download SRT
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  if (
                    transcript.edited &&
                    !window.confirm(
                      "This transcript has manual edits. Regenerating replaces them. Continue?",
                    )
                  ) {
                    return
                  }
                  props.onGenerate()
                }}
                data-testid="regenerate-transcript"
              >
                <RefreshCw className="size-3.5" /> Regenerate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {props.editing ? (
          <div className="mt-3">
            <p className="mb-2 text-[12px] text-zinc-500">
              One line per segment. Timings stay as they are.
            </p>
            <Textarea
              value={props.draft}
              onChange={(e) => props.onDraftChange(e.target.value)}
              rows={12}
              className="rounded-xl font-mono text-[12.5px]"
            />
            <div className="mt-2 flex gap-1.5">
              <Button type="button" size="sm" onClick={props.onEditSave} disabled={props.saving}>
                {props.saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={props.onEditCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <TranscriptSegments
              segments={segments}
              query={props.search}
              activeIndex={props.activeIndex}
              onSeek={props.onSeek}
            />
          </div>
        )}
      </div>
    )
  }

  // Nothing yet. Nothing has been sent anywhere.
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
      <Sparkles className="mx-auto size-5 text-primary" />
      <p className="mt-2 text-[13px] font-medium text-foreground">AI transcript</p>
      <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
        Generate a timestamped transcript from the spoken audio in this video. Gemini reads the
        audio only when you ask.
      </p>
      <Button
        type="button"
        size="sm"
        className="mt-3"
        onClick={props.onGenerate}
        disabled={props.starting}
        data-testid="generate-transcript"
      >
        {props.starting ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        Generate transcript
      </Button>
    </div>
  )
}

function Notice({
  icon,
  title,
  tone = "muted",
  children,
}: {
  icon: React.ReactNode
  title: string
  tone?: "muted" | "danger"
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3.5 py-3",
        tone === "danger" ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/40",
      )}
      data-testid="transcript-notice"
    >
      <p className="flex items-center gap-2 text-[13px] font-medium text-foreground">
        <span className={tone === "danger" ? "text-destructive" : "text-muted-foreground"}>
          {icon}
        </span>
        {title}
      </p>
      <div className="mt-1 text-[12.5px] text-muted-foreground">{children}</div>
    </div>
  )
}

function RetryButton({ onClick, label = "Generate again" }: { onClick: () => void; label?: string }) {
  return (
    <div className="mt-2.5">
      <Button type="button" size="sm" variant="outline" onClick={onClick} data-testid="retry-transcript">
        <RefreshCw className="size-3.5" /> {label}
      </Button>
    </div>
  )
}
