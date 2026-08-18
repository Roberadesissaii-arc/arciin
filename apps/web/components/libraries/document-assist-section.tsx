"use client"

import { useEffect, useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { DocumentAiSummarize } from "@/components/libraries/document-ai-summarize"
import { ensureDocumentMetadata, isPdfAsset } from "@/lib/api/documents"
import { queryKeys } from "@/lib/api/query-keys"
import type { AssetSummary } from "@/lib/types/models"

/**
 * Assist workspace for documents (PDFs).
 *
 * Default entry from the card menu still lands on Overview; this section is
 * Assist-only — summarize. On open, older PDFs without pageCount get a one-shot
 * metadata backfill so Overview/Details can show pages and author.
 */
export function DocumentAssistSection({ asset }: { asset: AssetSummary | null }) {
  const queryClient = useQueryClient()
  const triedMeta = useRef<string | null>(null)

  const meta = useMutation({
    mutationFn: (assetId: string) => ensureDocumentMetadata(assetId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
    },
  })

  useEffect(() => {
    if (!asset) return
    if (!isPdfAsset(asset)) return
    if (asset.pageCount != null) return
    if (triedMeta.current === asset.id) return
    triedMeta.current = asset.id
    meta.mutate(asset.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one shot per asset id
  }, [asset?.id, asset?.pageCount])

  if (!asset) return null

  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      data-testid="document-assist-section"
    >
      <div className="mt-4">
        <nav
          className="flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1"
          aria-label="Assist sections"
        >
          <span className="flex-1 rounded-lg bg-white px-2 py-2 text-center text-[12px] font-semibold text-zinc-900 shadow-sm ring-1 ring-zinc-200/80">
            Summarize
          </span>
        </nav>
      </div>

      <DocumentAiSummarize
        asset={asset}
        savedInsight={asset.documentInsight ?? null}
        onInsightSaved={(insight) => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
          Object.assign(asset, { documentInsight: insight })
        }}
      />
    </div>
  )
}
