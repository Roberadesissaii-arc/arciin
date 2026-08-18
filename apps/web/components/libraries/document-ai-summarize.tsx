"use client"

import { useEffect, useState } from "react"
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
import { isPdfAsset, requestDocumentSummary, type DocumentInsight } from "@/lib/api/documents"
import { queryKeys } from "@/lib/api/query-keys"
import { toast } from "@/lib/notifications/arciin-toast"
import type { AssetSummary } from "@/lib/types/models"

function aboutKindLabel(kind: string): string {
  switch (kind) {
    case "book":
      return "Book"
    case "movie":
      return "Movie"
    case "person":
      return "Person"
    case "product":
      return "Product"
    case "topic":
      return "Topic"
    default:
      return "About"
  }
}

/**
 * Assist → Summarize for PDFs.
 *
 * Simpler than video Assist: one job, no transcript prerequisite. Result lives
 * on Asset.documentInsight so closing the panel keeps it.
 */
export function DocumentAiSummarize({
  asset,
  savedInsight,
  onInsightSaved,
}: {
  asset: AssetSummary
  savedInsight?: DocumentInsight | null
  onInsightSaved?: (insight: DocumentInsight) => void
}) {
  const queryClient = useQueryClient()
  const [summary, setSummary] = useState<string | null>(savedInsight?.summary ?? null)
  const [keywords, setKeywords] = useState<string[]>(savedInsight?.keywords ?? [])
  const [links, setLinks] = useState<string[]>(savedInsight?.links ?? [])
  const [about, setAbout] = useState<DocumentInsight["about"]>(savedInsight?.about ?? null)
  const [topics, setTopics] = useState<string[]>(savedInsight?.topics ?? [])

  useEffect(() => {
    if (!savedInsight) return
    setSummary(savedInsight.summary || null)
    setKeywords(savedInsight.keywords ?? [])
    setLinks(savedInsight.links ?? [])
    setAbout(savedInsight.about ?? null)
    setTopics(savedInsight.topics ?? [])
  }, [savedInsight])

  const summarize = useMutation({
    mutationKey: ["document-summary", asset.id],
    mutationFn: () => requestDocumentSummary(asset.id),
    onSuccess: (data) => {
      setSummary(data.summary || null)
      setKeywords(data.keywords)
      setLinks(data.links)
      setAbout(data.about ?? null)
      setTopics(data.topics ?? [])
      onInsightSaved?.(data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
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
      const friendly = friendlyAiError(error, {
        title: "Could not summarize",
        description: "Try again in a moment.",
      })
      toast.error(friendly.title, { description: friendly.description })
    },
  })

  if (!isPdfAsset(asset)) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-center">
        <Sparkles className="mx-auto size-5 text-primary" />
        <p className="mt-2 text-[13px] font-medium text-foreground">Summarize</p>
        <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
          Assist summarize is available for PDF documents.
        </p>
      </div>
    )
  }

  const busy = summarize.isPending
  const hasResult =
    Boolean(summary) ||
    keywords.length > 0 ||
    links.length > 0 ||
    Boolean(about) ||
    topics.length > 0

  return (
    <div className="mt-3 space-y-3" data-testid="document-summary-section">
      {!hasResult && !busy ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
          <TextQuote className="mx-auto size-5 text-primary" />
          <p className="mt-2 text-[13px] font-medium text-foreground">Summarize</p>
          <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
            Get a short synopsis, topics, and keywords from this PDF. Gemini reads extracted text,
            not the file again after that.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            onClick={() => summarize.mutate()}
            data-testid="generate-document-summary"
          >
            <Sparkles className="size-3.5" />
            Summarize
          </Button>
        </div>
      ) : null}

      {busy && !hasResult ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <span>Summarizing…</span>
        </div>
      ) : null}

      {hasResult ? (
        <>
          {about ? (
            <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
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
                data-testid="document-summary-text"
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
              <div className="flex flex-wrap gap-1.5 px-3 py-3">
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
              <div className="flex flex-wrap gap-1.5 px-3 py-3">
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
            onClick={() => summarize.mutate()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {busy ? "Summarizing…" : "Run again"}
          </Button>
        </>
      ) : null}
    </div>
  )
}
