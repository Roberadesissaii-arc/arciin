"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Clapperboard,
  Hash,
  Loader2,
  Sparkles,
  Tag,
  TextQuote,
} from "lucide-react"

import { AiSummaryLinks } from "@/components/libraries/ai-summary-links"
import { Button } from "@/components/ui/button"
import { friendlyAiError } from "@/lib/ai/friendly-ai-error"
import { requestTranscriptSummary } from "@/lib/api/transcripts"
import { toast } from "@/lib/notifications/arciin-toast"
import type { AssetSummary } from "@/lib/types/models"
import type { TranscriptAiAbout, TranscriptAiInsight } from "@arciin/types"

/** In-flight summarize runs — survives tab switches and remounts. */
const pendingSummaries = new Set<string>()

function aboutKindLabel(kind: string): string {
  switch (kind) {
    case "movie":
      return "Movie"
    case "tv_show":
      return "TV show"
    case "book":
      return "Book"
    case "game":
      return "Game"
    case "music":
      return "Music"
    case "person":
      return "Person"
    case "product":
      return "Product"
    case "event":
      return "Event"
    case "topic":
      return "Topic"
    default:
      return "About"
  }
}

export function VideoAiSummarize({
  asset,
  hasTranscript,
  transcriptStatus,
  savedInsight,
  onGenerateTranscript,
  transcriptRunning = false,
  onInsightSaved,
}: {
  asset: AssetSummary
  hasTranscript: boolean
  transcriptStatus: string | null
  /** Previously saved summarize result (from the transcript row). */
  savedInsight?: TranscriptAiInsight | null
  onGenerateTranscript: () => void
  transcriptRunning?: boolean
  /** After a successful generate — parent can merge into its transcript cache. */
  onInsightSaved?: (insight: TranscriptAiInsight) => void
}) {
  const queryClient = useQueryClient()
  const [summary, setSummary] = useState<string | null>(savedInsight?.summary ?? null)
  const [keywords, setKeywords] = useState<string[]>(savedInsight?.keywords ?? [])
  const [links, setLinks] = useState<string[]>(savedInsight?.links ?? [])
  const [about, setAbout] = useState<TranscriptAiAbout | null>(savedInsight?.about ?? null)
  const [topics, setTopics] = useState<string[]>(savedInsight?.topics ?? [])
  /** True only when Summarize itself asked for a transcript — not when Transcript tab is busy. */
  const [awaitingTranscript, setAwaitingTranscript] = useState(false)
  /**
   * Derived, not stored.
   *
   * "A summarize is running that this panel did not start" is a fact about the
   * module-level `pendingSummaries` set and whether the insight has landed yet.
   * Keeping a copy in state meant writing it from two effects, and the write in
   * the polling effect below was a synchronous setState in an effect body.
   */
  const pendingElsewhere = pendingSummaries.has(asset.id) && !savedInsight
  const kickedOff = useRef(false)

  /**
   * Adopt the saved insight when it arrives (or changes after a regenerate).
   *
   * Adjusted while rendering rather than in an effect: an effect shows the old
   * summary for one paint and then replaces it. Clearing the module-level
   * pending marker is a genuine external-store side effect and stays below.
   */
  const [appliedInsight, setAppliedInsight] = useState(savedInsight ?? null)
  if (savedInsight && savedInsight !== appliedInsight) {
    setAppliedInsight(savedInsight)
    setSummary(savedInsight.summary || null)
    setKeywords(savedInsight.keywords ?? [])
    setLinks(savedInsight.links ?? [])
    setAbout(savedInsight.about ?? null)
    setTopics(savedInsight.topics ?? [])
  }

  useEffect(() => {
    if (!savedInsight) return
    pendingSummaries.delete(asset.id)
  }, [savedInsight, asset.id])

  const summarize = useMutation({
    mutationKey: ["transcript-summary", asset.id],
    mutationFn: () => requestTranscriptSummary(asset.id),
    onMutate: () => {
      pendingSummaries.add(asset.id)
    },
    onSuccess: (data) => {
      pendingSummaries.delete(asset.id)
      setAwaitingTranscript(false)
      kickedOff.current = false
      setSummary(data.summary || null)
      setKeywords(data.keywords)
      setLinks(data.links)
      setAbout(data.about ?? null)
      setTopics(data.topics ?? [])
      onInsightSaved?.(data)
      if (
        !data.summary &&
        data.keywords.length === 0 &&
        data.links.length === 0 &&
        !data.about &&
        (data.topics?.length ?? 0) === 0
      ) {
        toast.error("Nothing useful came back", { description: "Try generating again." })
      }
    },
    onError: (error) => {
      pendingSummaries.delete(asset.id)
      setAwaitingTranscript(false)
      kickedOff.current = false
      const friendly = friendlyAiError(error, {
        title: "Could not summarize",
        description: "Try again in a moment.",
      })
      toast.error(friendly.title, { description: friendly.description })
    },
  })

  const transcriptFailed =
    transcriptStatus === "FAILED" ||
    transcriptStatus === "NO_AUDIO" ||
    transcriptStatus === "NO_SPEECH"

  useEffect(() => {
    if (!awaitingTranscript) return
    if (transcriptStatus !== "READY" || !hasTranscript) return
    if (summarize.isPending || kickedOff.current) return
    kickedOff.current = true
    summarize.mutate()
  }, [awaitingTranscript, hasTranscript, transcriptStatus, summarize])

  // Stop the infinite "preparing" spinner when the background transcript fails.
  useEffect(() => {
    if (!awaitingTranscript || !transcriptFailed) return
    setAwaitingTranscript(false)
    kickedOff.current = false
    const description =
      transcriptStatus === "NO_AUDIO"
        ? "This video has no audio track to summarize."
        : transcriptStatus === "NO_SPEECH"
          ? "No speech was detected, so nothing useful could be summarized."
          : "The transcript failed. Try Summarize again."
    toast.error("Could not prepare a transcript", { description })
  }, [awaitingTranscript, transcriptFailed, transcriptStatus])

  // If the reader left Assist while summarize was running, poll until the
  // persisted insight shows up — no second button press required.
  useEffect(() => {
    if (!pendingSummaries.has(asset.id)) return
    if (savedInsight) return
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["asset-transcript", asset.id] })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [asset.id, savedInsight, queryClient])

  function startSummarize() {
    if (hasTranscript && transcriptStatus === "READY") {
      summarize.mutate()
      return
    }
    setAwaitingTranscript(true)
    kickedOff.current = false
    // A transcript may already be running, started from the Transcript tab or
    // from Title. Queue onto that one; starting a second would duplicate the
    // work and race for the same row.
    if (!transcriptRunning) onGenerateTranscript()
  }

  const waitingForTranscript =
    awaitingTranscript &&
    !transcriptFailed &&
    (transcriptRunning ||
      transcriptStatus === "PENDING" ||
      transcriptStatus === "RUNNING" ||
      transcriptStatus === "PROCESSING" ||
      !hasTranscript)
  const busy = summarize.isPending || waitingForTranscript || pendingElsewhere
  const hasResult =
    Boolean(summary) ||
    keywords.length > 0 ||
    links.length > 0 ||
    Boolean(about) ||
    topics.length > 0

  // No transcript yet and Summarize was not asked for one. A transcript running
  // elsewhere does not disable this tab: asking here queues onto it.
  if (!hasTranscript && !waitingForTranscript) {
    return (
      <div
        className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-center"
        data-testid="ai-summary-needs-transcript"
      >
        <Sparkles className="mx-auto size-5 text-primary" />
        <p className="mt-2 text-[13px] font-medium text-foreground">Summarize</p>
        <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
          {transcriptRunning
            ? "A transcript is being prepared. Ask for a summary now — it arrives as soon as it lands."
            : transcriptFailed
              ? "Transcript preparation failed. Summarize will retry it here — you stay on this tab."
              : "Get a synopsis from what the video says. Summarize prepares a transcript in the background and stays on this tab."}
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-3"
          onClick={startSummarize}
          data-testid="generate-ai-summary"
        >
          <Sparkles className="size-3.5" />
          Summarize
        </Button>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3" data-testid="ai-summary-section">
      {!hasResult && !busy ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
          <TextQuote className="mx-auto size-5 text-primary" />
          <p className="mt-2 text-[13px] font-medium text-foreground">Summarize</p>
          <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
            Get a synopsis, topics, keywords, and any movie/show/product the video is about. Gemini
            reads the saved transcript, never the video again.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={busy}
            onClick={startSummarize}
            data-testid="generate-ai-summary"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {busy ? "Summarizing…" : "Summarize"}
          </Button>
        </div>
      ) : null}

      {waitingForTranscript ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <span>Preparing a transcript, then summarizing…</span>
        </div>
      ) : null}

      {(summarize.isPending || pendingElsewhere) && !waitingForTranscript && !hasResult ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <span>Summarizing…</span>
        </div>
      ) : null}

      {hasResult ? (
        <>
          {about ? (
            <section
              className="overflow-hidden rounded-xl border border-zinc-200 bg-white"
              data-testid="ai-summary-about"
            >
              <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2">
                <Clapperboard className="size-3.5 text-zinc-400" />
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Detected
                </h4>
              </div>
              <div className="flex flex-wrap items-start gap-2 px-3 py-3">
                <span className="rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
                  {aboutKindLabel(about.kind)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-zinc-900">{about.title}</p>
                  {about.note ? (
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-500">{about.note}</p>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {summary ? (
            <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2">
                <TextQuote className="size-3.5 text-zinc-400" />
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Summary
                </h4>
              </div>
              <p
                className="whitespace-pre-wrap px-3 py-3 text-[13px] leading-relaxed text-zinc-800"
                data-testid="ai-summary-text"
              >
                {summary}
              </p>
            </section>
          ) : null}

          {topics.length > 0 ? (
            <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2">
                <Tag className="size-3.5 text-zinc-400" />
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Topics
                </h4>
              </div>
              <div className="flex flex-wrap gap-1.5 px-3 py-3" data-testid="ai-summary-topics">
                {topics.map((topic) => (
                  <span
                    key={topic}
                    className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11.5px] font-medium text-sky-800"
                  >
                    {topic}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {keywords.length > 0 ? (
            <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2">
                <Hash className="size-3.5 text-zinc-400" />
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Keywords
                </h4>
              </div>
              <div className="flex flex-wrap gap-1.5 px-3 py-3" data-testid="ai-summary-keywords">
                {keywords.map((keyword) => (
                  <span
                    key={keyword}
                    className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11.5px] font-medium text-zinc-700"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {links.length > 0 ? <AiSummaryLinks links={links} /> : null}

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-full border-border bg-card text-[12px]"
            disabled={busy}
            onClick={startSummarize}
            data-testid="generate-ai-summary-again"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {busy ? "Summarizing…" : "Run again"}
          </Button>
        </>
      ) : null}
    </div>
  )
}
