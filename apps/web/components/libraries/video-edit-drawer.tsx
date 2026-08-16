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
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  saveAssetTranscript,
} from "@/lib/api/transcripts"
import { VideoAssetViewer } from "@/components/libraries/video-asset-viewer"
import { formatBytes } from "@/lib/utils/format-bytes"
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
import type { AssetSummary } from "@/lib/types/models"

const transcriptKey = (assetId: string) => ["asset-transcript", assetId] as const

/** Human duration for the header line. */
function formatDuration(seconds: number | null | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null
  return formatTimecode(seconds * 1000)
}

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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 first:mt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h3>
      <div className="mt-2 border-t border-border" />
    </div>
  )
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
    <ol className="mt-3 space-y-3" data-testid="video-transcript-segments">
      {rows.map(({ s, i, newSpeaker }) => {
        return (
          <li key={`${s.startMs}-${i}`}>
            {newSpeaker ? (
              <p className="mb-1 text-[12px] font-semibold text-foreground">{s.speaker}</p>
            ) : null}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => onSeek(s.startMs)}
                className="shrink-0 pt-0.5 font-mono text-[11px] tabular-nums text-primary hover:underline"
                aria-label={`Jump to ${formatTimecode(s.startMs, { forceHours: long })}`}
                data-testid="transcript-timestamp"
                data-start-ms={s.startMs}
              >
                {formatTimecode(s.startMs, { forceHours: long })}
              </button>
              <p
                className={cn(
                  "min-w-0 flex-1 text-[13.5px] leading-relaxed",
                  i === activeIndex ? "font-medium text-foreground" : "text-foreground/85",
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

export function VideoEditDrawer({
  asset,
  open,
  onOpenChange,
}: {
  asset: AssetSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
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
    enabled: Boolean(assetId) && open,
    refetchInterval: (query) => {
      const status = query.state.data?.transcript?.status
      return status && isTranscriptRunning(status) ? 3000 : false
    },
  })

  const transcript: MediaTranscript | null = transcriptQuery.data?.transcript ?? null
  // Memoised so the active-segment lookup below is not recomputed on every
  // render just because `?? []` produced a fresh array.
  const segments = useMemo(() => transcript?.segments ?? [], [transcript])
  const running = transcript ? isTranscriptRunning(transcript.status) : false

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
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setSearch("")
        setEditing(false)
      }
      onOpenChange(next)
    },
    [onOpenChange],
  )

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

  const duration = formatDuration(asset?.durationSeconds ?? null)
  const resolution =
    asset?.width && asset?.height ? `${asset.width}×${asset.height}` : null

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        data-testid="video-edit-drawer"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]"
      >
        <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
          <SheetTitle className="text-[15px]">Edit video</SheetTitle>
          <SheetDescription className="sr-only">
            Preview this video, review its details, and generate a transcript.
          </SheetDescription>
        </SheetHeader>

        {asset ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
            {/* The library's own player, lent a ref so the transcript can seek it. */}
            <div
              className="mt-4 flex max-h-[280px] items-center justify-center overflow-hidden rounded-xl bg-black"
              data-testid="video-edit-player"
            >
              <VideoAssetViewer
                src={`/api/assets/${asset.id}/download?inline=1&v=${encodeURIComponent(asset.updatedAt)}`}
                mediaRef={videoRef}
                onTimeChange={(seconds) => setCurrentMs(seconds * 1000)}
              />
            </div>

            <p className="mt-3 truncate text-[13.5px] font-medium text-foreground" title={asset.originalFilename}>
              {asset.originalFilename}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {[duration, resolution, formatBytes(asset.sizeBytes)].filter(Boolean).join(" · ")}
            </p>

            <SectionHeading>Details</SectionHeading>
            <dl className="mt-3 grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[12.5px]">
              <dt className="text-muted-foreground">Filename</dt>
              <dd className="min-w-0 break-words text-foreground">{asset.originalFilename}</dd>
              <dt className="text-muted-foreground">Format</dt>
              <dd className="text-foreground">{asset.mimeType}</dd>
              {duration ? (
                <>
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="text-foreground tabular-nums">{duration}</dd>
                </>
              ) : null}
              {resolution ? (
                <>
                  <dt className="text-muted-foreground">Resolution</dt>
                  <dd className="text-foreground tabular-nums">{resolution}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Size</dt>
              <dd className="text-foreground tabular-nums">{formatBytes(asset.sizeBytes)}</dd>
              <dt className="text-muted-foreground">Added</dt>
              <dd className="text-foreground">
                {new Date(asset.createdAt).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </dd>
            </dl>

            <SectionHeading>Transcript</SectionHeading>
            <div className="mt-3" data-testid="video-transcript">
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
                editing={editing}
                draft={draft}
                onEditStart={() => {
                  setDraft(segments.map((s) => s.text).join("\n"))
                  setEditing(true)
                }}
                onDraftChange={setDraft}
                onEditCancel={() => setEditing(false)}
                onEditSave={() => saveEdit.mutate(draft)}
                saving={saveEdit.isPending}
              />
            </div>
          </div>
        ) : null}
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
  onEditStart: () => void
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

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="outline" onClick={() => props.onCopy(false)}>
            <Copy className="size-3.5" /> Copy
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => props.onCopy(true)}>
            <Copy className="size-3.5" /> With times
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => props.onDownload("txt")}>
            <Download className="size-3.5" /> .txt
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => props.onDownload("srt")}>
            <Download className="size-3.5" /> .srt
          </Button>
          {!props.editing ? (
            <Button type="button" size="sm" variant="outline" onClick={props.onEditStart}>
              <Pencil className="size-3.5" /> Edit
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={props.onGenerate}
            data-testid="regenerate-transcript"
          >
            <RefreshCw className="size-3.5" /> Regenerate
          </Button>
        </div>

        {props.editing ? (
          <div className="mt-3">
            <p className="mb-2 text-[12px] text-muted-foreground">
              One line per segment. Timings are kept as they are.
            </p>
            <Textarea
              value={props.draft}
              onChange={(e) => props.onDraftChange(e.target.value)}
              rows={12}
              className="font-mono text-[12.5px]"
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
          <>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={props.search}
                onChange={(e) => props.onSearch(e.target.value)}
                placeholder="Search transcript…"
                className="h-8 pl-8 text-[13px]"
                data-testid="transcript-search"
              />
            </div>
            <TranscriptSegments
              segments={segments}
              query={props.search}
              activeIndex={props.activeIndex}
              onSeek={props.onSeek}
            />
          </>
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
