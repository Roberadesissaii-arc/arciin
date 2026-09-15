"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Hash, Loader2, Sparkles, Tag } from "lucide-react"

import { Button } from "@/components/ui/button"
import { friendlyAiError } from "@/lib/ai/friendly-ai-error"
import { isTextAssistAsset, requestDocumentSummary, type DocumentInsight } from "@/lib/api/documents"
import { queryKeys } from "@/lib/api/query-keys"
import { toast } from "@/lib/notifications/arciin-toast"
import type { AssetSummary } from "@/lib/types/models"

/**
 * Keywords / topics tab — same underlying document insight as Summarize,
 * focused on tags for finding the file later.
 */
export function DocumentAiKeywords({
  asset,
  savedInsight,
  onInsightSaved,
}: {
  asset: AssetSummary
  savedInsight?: DocumentInsight | null
  onInsightSaved?: (insight: DocumentInsight) => void
}) {
  const queryClient = useQueryClient()
  const [keywords, setKeywords] = useState<string[]>(savedInsight?.keywords ?? [])
  const [topics, setTopics] = useState<string[]>(savedInsight?.topics ?? [])

  /**
   * Adopt a newly-saved insight without an effect.
   *
   * This is state derived from a prop that the component also edits locally, so
   * it cannot simply be read from the prop. React's answer is to adjust it
   * while rendering, guarded by the previous value: an effect would paint the
   * stale keywords first and correct them on a second pass, which is the
   * cascading render the lint rule is about.
   */
  const [appliedInsight, setAppliedInsight] = useState(savedInsight ?? null)
  if (savedInsight && savedInsight !== appliedInsight) {
    setAppliedInsight(savedInsight)
    setKeywords(savedInsight.keywords ?? [])
    setTopics(savedInsight.topics ?? [])
  }

  const generate = useMutation({
    mutationKey: ["document-keywords", asset.id],
    mutationFn: () => requestDocumentSummary(asset.id),
    onSuccess: (data) => {
      setKeywords(data.keywords)
      setTopics(data.topics ?? [])
      onInsightSaved?.(data)
      void queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
      if (data.keywords.length === 0 && (data.topics?.length ?? 0) === 0) {
        toast.error("No keywords came back", { description: "Try generating again." })
      }
    },
    onError: (error) => {
      const friendly = friendlyAiError(error, {
        title: "Could not extract keywords",
        description: "Try again in a moment.",
      })
      toast.error(friendly.title, { description: friendly.description })
    },
  })

  if (!isTextAssistAsset(asset)) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-center">
        <Hash className="mx-auto size-5 text-primary" />
        <p className="mt-2 text-[13px] font-medium text-foreground">Keywords</p>
        <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
          Keywords are available for PDFs and source files.
        </p>
      </div>
    )
  }

  const busy = generate.isPending
  const hasResult = keywords.length > 0 || topics.length > 0

  return (
    <div className="mt-3 space-y-3" data-testid="document-keywords-section">
      {!hasResult && !busy ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
          <Hash className="mx-auto size-5 text-primary" />
          <p className="mt-2 text-[13px] font-medium text-foreground">Keywords</p>
          <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
            Pull keywords and topics from this PDF so you can find it later in your library.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            onClick={() => generate.mutate()}
            data-testid="generate-document-keywords"
          >
            <Sparkles className="size-3.5" />
            Generate keywords
          </Button>
        </div>
      ) : null}

      {busy && !hasResult ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <span>Extracting keywords…</span>
        </div>
      ) : null}

      {hasResult ? (
        <>
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

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 w-full border-border bg-card text-[12px]"
            disabled={busy}
            onClick={() => generate.mutate()}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {busy ? "Extracting…" : "Run again"}
          </Button>
        </>
      ) : null}
    </div>
  )
}
