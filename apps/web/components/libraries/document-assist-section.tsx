"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Download, Trash2 } from "lucide-react"

import { AssetPreview } from "@/components/libraries/asset-preview"
import { DocumentAiKeywords } from "@/components/libraries/document-ai-keywords"
import { DocumentAiSummarize } from "@/components/libraries/document-ai-summarize"
import { DocumentAiTitle } from "@/components/libraries/document-ai-title"
import { Button } from "@/components/ui/button"
import { ensureDocumentMetadata, isPdfAsset, type DocumentInsight } from "@/lib/api/documents"
import { queryKeys } from "@/lib/api/query-keys"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

type DocAiTab = "summary" | "title" | "keywords"

/**
 * Assist workspace for PDFs — same shell as video Assist:
 * preview on top, three tabs, content, then Open / Download / Delete.
 */
export function DocumentAssistSection({
  asset,
  onOpen,
  onDownload,
  onDelete,
}: {
  asset: AssetSummary | null
  onOpen?: () => void
  onDownload: () => void
  onDelete: () => void
}) {
  const queryClient = useQueryClient()
  const triedMeta = useRef<string | null>(null)
  const [aiTab, setAiTab] = useState<DocAiTab>("summary")
  const [insight, setInsight] = useState<DocumentInsight | null>(
    asset?.documentInsight ?? null,
  )

  useEffect(() => {
    setInsight(asset?.documentInsight ?? null)
  }, [asset?.id, asset?.documentInsight])

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

  function onInsightSaved(next: DocumentInsight) {
    setInsight(next)
    Object.assign(asset!, { documentInsight: next })
    void queryClient.invalidateQueries({ queryKey: queryKeys.assetsRoot })
  }

  return (
    <>
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-5 pb-8",
          "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        )}
        data-testid="document-assist-section"
      >
        {/* Preview — same placement as the video player in video Assist. */}
        <div
          className="mt-4 flex w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-zinc-50 max-h-[240px] min-h-[120px]"
          data-testid="document-assist-preview"
        >
          <AssetPreview asset={asset} />
        </div>

        {/* Summarize / Title / Keywords — three jobs on the same document. */}
        <div className="mt-5">
          <nav
            className="flex gap-1 rounded-xl border border-zinc-200 bg-zinc-50 p-1"
            aria-label="Assist sections"
            data-testid="document-ai-nav"
          >
            {(
              [
                ["summary", "Summarize"],
                ["title", "Title"],
                ["keywords", "Keywords"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAiTab(key)}
                aria-current={aiTab === key ? "page" : undefined}
                data-testid={`document-ai-tab-${key}`}
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

        {/* Keep tabs mounted so a running summarize is not torn down on switch. */}
        <div className={cn(aiTab !== "summary" && "hidden")}>
          <DocumentAiSummarize
            asset={asset}
            savedInsight={insight}
            onInsightSaved={onInsightSaved}
          />
        </div>
        <div className={cn(aiTab !== "title" && "hidden")}>
          <DocumentAiTitle asset={asset} />
        </div>
        <div className={cn(aiTab !== "keywords" && "hidden")}>
          <DocumentAiKeywords
            asset={asset}
            savedInsight={insight}
            onInsightSaved={onInsightSaved}
          />
        </div>
      </div>

      {/* Same footer as Overview — Open / Download / Delete always available. */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border p-2">
        {onOpen ? (
          <Button
            type="button"
            className="h-10 min-w-0 flex-1 bg-primary text-white hover:bg-primary/90"
            onClick={onOpen}
            data-testid="document-assist-open"
          >
            Open
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0 border-border"
          onClick={onDownload}
          data-testid="document-assist-download"
          aria-label="Download file"
          title="Download"
        >
          <Download className="size-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          data-testid="document-assist-delete"
          aria-label="Delete file"
          title="Delete"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </>
  )
}
