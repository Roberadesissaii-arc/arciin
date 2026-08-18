"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { ExternalLink, Hash, Loader2, Sparkles, TextQuote } from "lucide-react"

import { Button } from "@/components/ui/button"
import { requestTranscriptSummary } from "@/lib/api/transcripts"
import { toast } from "@/lib/notifications/arciin-toast"
import type { AssetSummary } from "@/lib/types/models"
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
  onGenerateTranscript,
  transcriptRunning = false,
}: {
  asset: AssetSummary
  hasTranscript: boolean
  /** Live transcript status so we can wait for READY without leaving this tab. */
  transcriptStatus: string | null
  onGenerateTranscript: () => void
  transcriptRunning?: boolean
}) {
  const [summary, setSummary] = useState<string | null>(null)
  const [keywords, setKeywords] = useState<string[]>([])
  const [links, setLinks] = useState<string[]>([])
  /** User asked for a summary before a transcript existed — finish it here. */
  const [awaitingTranscript, setAwaitingTranscript] = useState(false)
  const kickedOff = useRef(false)

  const summarize = useMutation({
    mutationFn: () => requestTranscriptSummary(asset.id),
    onSuccess: (data) => {
      setAwaitingTranscript(false)
      kickedOff.current = false
      setSummary(data.summary || null)
      setKeywords(data.keywords)
      setLinks(data.links)
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

  // When we kicked off a transcript just for summarize, run summarize once READY.
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
    // Stay on Summarize — do not bounce to the Transcript tab.
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

  return (
    <div className="mt-3 space-y-3" data-testid="ai-summary-section">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-[12px] leading-snug text-zinc-500">
          Synopsis, keywords, and links spoken in the video.
        </p>
        <Button
          type="button"
          size="sm"
          className="h-8 shrink-0 bg-primary text-white hover:bg-primary/90"
          disabled={busy}
          onClick={startSummarize}
          data-testid="generate-ai-summary"
        >
          {busy ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              {waitingForTranscript ? "Preparing…" : "Summarizing…"}
            </>
          ) : hasResult ? (
            "Run again"
          ) : (
            <>
              <Sparkles className="size-3.5" />
              Summarize
            </>
          )}
        </Button>
      </div>

      {waitingForTranscript ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-[12.5px] text-zinc-600">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <span>Building a transcript first, then summarizing — you can stay on this tab.</span>
        </div>
      ) : null}

      {!hasResult && !busy ? (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-6 text-center text-[12.5px] text-zinc-500">
          Press Summarize. If there is no transcript yet, Arciin prepares one in the background.
        </div>
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
    </div>
  )
}
