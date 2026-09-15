"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Check, Loader2, Wand2 } from "lucide-react"

import { titleToFilename } from "@/components/libraries/video-ai-title"
import { Button } from "@/components/ui/button"
import { useUpdateAsset } from "@/hooks/use-assets"
import { friendlyAiError } from "@/lib/ai/friendly-ai-error"
import { isTextAssistAsset, requestDocumentTitleSuggestions } from "@/lib/api/documents"
import { notifyFileUpdated } from "@/lib/notifications/toast-actions"
import { toast } from "@/lib/notifications/arciin-toast"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/**
 * AI title for a PDF or source file — same short 1–2 word suggestions as video.
 */
export function DocumentAiTitle({ asset }: { asset: AssetSummary }) {
  const [titles, setTitles] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const updateAsset = useUpdateAsset()

  const suggest = useMutation({
    mutationFn: () => requestDocumentTitleSuggestions(asset.id, { count: 3 }),
    onSuccess: (data) => {
      if (data.titles.length === 0) {
        toast.error("No titles came back", { description: "Try generating again." })
        return
      }
      setTitles(data.titles)
      setSelected(data.titles[0] ?? null)
    },
    onError: (error) => {
      const friendly = friendlyAiError(error, {
        title: "Could not suggest a title",
        description: "Try again in a moment.",
      })
      toast.error(friendly.title, { description: friendly.description })
    },
  })

  async function applyTitle() {
    if (!selected) return
    const filename = titleToFilename(selected, asset.originalFilename)
    if (filename === asset.originalFilename) return
    try {
      await updateAsset.mutateAsync({ assetId: asset.id, originalFilename: filename })
      notifyFileUpdated()
    } catch (error) {
      const friendly = friendlyAiError(error, {
        title: "Could not apply the title",
        description: "Try again in a moment.",
      })
      toast.error(friendly.title, { description: friendly.description })
    }
  }

  if (!isTextAssistAsset(asset)) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-center">
        <Wand2 className="mx-auto size-5 text-primary" />
        <p className="mt-2 text-[13px] font-medium text-foreground">AI title</p>
        <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
          Title suggestions are available for PDFs and source files.
        </p>
      </div>
    )
  }

  const busy = suggest.isPending
  const preview = selected ? titleToFilename(selected, asset.originalFilename) : null

  return (
    <div className="mt-3 space-y-3" data-testid="document-title-section">
      {titles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
          <Wand2 className="mx-auto size-5 text-primary" />
          <p className="mt-2 text-[13px] font-medium text-foreground">AI title</p>
          <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
            Suggest a short name from what this file is. One or two words — like a library label.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={busy}
            onClick={() => suggest.mutate()}
            data-testid="generate-document-title"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
            {busy ? "Thinking…" : "Generate titles"}
          </Button>
        </div>
      ) : (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            AI title suggestions
          </p>
          <div className="space-y-1.5" role="radiogroup" aria-label="AI title suggestions">
            {titles.map((title) => {
              const active = title === selected
              return (
                <button
                  key={title}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelected(title)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors",
                    active
                      ? "border-primary/40 bg-primary/5 text-foreground"
                      : "border-border text-foreground/85 hover:bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border",
                      active ? "border-primary bg-primary text-white" : "border-border",
                    )}
                    aria-hidden
                  >
                    {active ? <Check className="size-2.5" /> : null}
                  </span>
                  {title}
                </button>
              )
            })}
          </div>

          {preview ? (
            <p className="truncate text-[11.5px] text-muted-foreground">
              Renames to <span className="text-foreground">{preview}</span>
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-8 flex-1 gap-1.5 bg-primary text-[12px] text-white hover:bg-primary/90"
              disabled={!selected || updateAsset.isPending}
              onClick={() => void applyTitle()}
            >
              {updateAsset.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Apply title
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 border-border bg-card text-[12px]"
              disabled={busy}
              onClick={() => suggest.mutate()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
              Generate more
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
