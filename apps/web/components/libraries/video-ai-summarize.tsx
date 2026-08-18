"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { ExternalLink, Hash, Loader2, Sparkles, TextQuote } from "lucide-react"

import { Button } from "@/components/ui/button"
import { requestTranscriptSummary } from "@/lib/api/transcripts"
import { toast } from "@/lib/notifications/arciin-toast"
import type { AssetSummary } from "@/lib/types/models"
import type { TranscriptAiInsight } from "@arciin/types"
import { cn } from "@/lib/utils"

function normalizeHref(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed)) return `https://${trimmed}`
  return null
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
  const [summary, setSummary] = useState<string | null>(savedInsight?.summary ?? null)
  const [keywords, setKeywords] = useState<string[]>(savedInsight?.keywords ?? [])
  const [links, setLinks] = useState<string[]>(savedInsight?.links ?? [])
  const [awaitingTranscript, setAwaitingTranscript] = useState(false)
  const kickedOff = useRef(false)

  // Hydrate when the saved insight arrives (or changes after regenerate).
  useEffect(() => {
    if (!savedInsight) return
    setSummary(savedInsight.summary || null)
    setKeywords(savedInsight.keywords ?? [])
    setLinks(savedInsight.links ?? [])
  }, [savedInsight])

  const summarize = useMutation({
    mutationFn: () => requestTranscriptSummary(asset.id),
    onSuccess: (data) => {
      setAwaitingTranscript(false)
      kickedOff.current = false
      setSummary(data.summary || null)
      setKeywords(data.keywords)
      setLinks(data.links)
      onInsightSaved?.(data)
      if (!data.summary && data.keywords.length === 0 && data.links.length === 0) {
        toast.error("Nothing useful came back", { description: "Try generating again." })
      }
    },
    onError: (error) => {
      setAwaitingTranscript(false)
      kickedOff.current = false
      toast.error("Could not summarize", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      })
    },
  })

  useEffect(() => {
    if (!awaitingTranscript) return
    if (transcriptStatus !== "READY" || !hasTranscript) return
    if (summarize.isPending || kickedOff.current) return
    kickedOff.current = true
    summarize.mutate()
  }, [awaitingTranscript, hasTranscript, transcriptStatus, summarize])

  function startSummarize() {
    if (hasTranscript && transcriptStatus === "READY") {
      summarize.mutate()
      return
    }
    setAwaitingTranscript(true)
    kickedOff.current = false
    onGenerateTranscript()
  }

  const waitingForTranscript =
    awaitingTranscript &&
    (transcriptRunning ||
      transcriptStatus === "PENDING" ||
      transcriptStatus === "RUNNING" ||
      transcriptStatus === "PROCESSING" ||
      !hasTranscript)
  const busy = summarize.isPending || waitingForTranscript
  const hasResult = Boolean(summary) || keywords.length > 0 || links.length > 0

  if (!hasTranscript && !waitingForTranscript) {
    return (
      <div
        className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-center"
        data-testid="ai-summary-needs-transcript"
      >
        <Sparkles className="mx-auto size-5 text-primary" />
        <p className="mt-2 text-[13px] font-medium text-foreground">Summarize</p>
        <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
          A summary comes from what the video says, so it needs a transcript first.
          Generating one here starts it — you stay on this tab.
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-3"
          onClick={startSummarize}
          disabled={transcriptRunning}
          data-testid="ai-summary-generate-transcript"
        >
          {transcriptRunning ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {transcriptRunning ? "Transcribing…" : "Generate transcript"}
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
            Get a short synopsis, keywords, and any links spoken in the video. Gemini reads the
            saved transcript, never the video again.
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

      {summarize.isPending && !waitingForTranscript ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <span>Summarizing…</span>
        </div>
      ) : null}

      {hasResult ? (
        <>
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

          {links.length > 0 ? (
            <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <div className="flex items-center gap-1.5 border-b border-zinc-100 px-3 py-2">
                <ExternalLink className="size-3.5 text-zinc-400" />
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Links mentioned
                </h4>
              </div>
              <ul className="divide-y divide-zinc-100" data-testid="ai-summary-links">
                {links.map((link) => {
                  const href = normalizeHref(link)
                  return (
                    <li key={link} className="px-3 py-2.5">
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            "inline-flex max-w-full items-center gap-1.5 break-all text-[12.5px] font-medium",
                            "text-primary hover:underline",
                          )}
                        >
                          <ExternalLink className="size-3 shrink-0" />
                          {link}
                        </a>
                      ) : (
                        <span className="break-all text-[12.5px] text-zinc-700">{link}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

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
