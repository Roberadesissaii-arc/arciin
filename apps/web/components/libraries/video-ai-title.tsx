"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Check, Loader2, Sparkles, Wand2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useUpdateAsset } from "@/hooks/use-assets"
import { requestTitleSuggestions } from "@/lib/api/transcripts"
import { notifyFileUpdated } from "@/lib/notifications/toast-actions"
import { toast } from "@/lib/notifications/arciin-toast"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/**
 * A name for a video, from what the video actually says.
 *
 * The problem this solves is `7492908407147073536.mp4` — a file that is
 * impossible to find again because its name records where it came from rather
 * than what it is. The transcript already exists, so a good title is a text
 * question, not a reason to re-read the media.
 *
 * Suggestions never rename anything. The model proposes; applying is a separate
 * act, and it goes through the same asset update the Edit form uses so the
 * sanitising and collision rules are the ones already in place.
 */

/** `.mp4` from `clip.mp4` — the model is never allowed to choose this. */
function extensionOf(filename: string): string {
  const match = /\.[A-Za-z0-9]{1,8}$/.exec(filename)
  return match ? match[0] : ""
}

/**
 * A title turned into a filename, keeping the original extension.
 *
 * Characters that are illegal in a filename are replaced rather than dropped,
 * so words do not silently run together, and the whole thing is capped well
 * inside the 255 the API accepts.
 */
export function titleToFilename(title: string, originalFilename: string): string {
  const extension = extensionOf(originalFilename)
  const base = title
    .replace(/[\r\n\t]+/g, " ")
    .replace(/["'“”‘’]/g, "")
    .replace(/[/\\:*?<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "")
    .slice(0, 200)
    .trim()
  if (!base) return originalFilename
  return `${base}${extension}`
}

export function VideoAiTitle({
  asset,
  hasTranscript,
  onGenerateTranscript,
}: {
  asset: AssetSummary
  hasTranscript: boolean
  /** Sends the reader to the transcript rather than starting one behind them. */
  onGenerateTranscript: () => void
}) {
  const [titles, setTitles] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const updateAsset = useUpdateAsset()

  const suggest = useMutation({
    mutationFn: () => requestTitleSuggestions(asset.id, { count: 3 }),
    onSuccess: (data) => {
      if (data.titles.length === 0) {
        toast.error("No titles came back", { description: "Try generating again." })
        return
      }
      setTitles(data.titles)
      setSelected(data.titles[0] ?? null)
    },
    onError: (error) => {
      toast.error("Could not suggest a title", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      })
    },
  })

  async function applyTitle() {
    if (!selected) return
    const filename = titleToFilename(selected, asset.originalFilename)
    if (filename === asset.originalFilename) return
    try {
      // The same update the Edit form performs — one rename path, one set of
      // rules about what a name may be.
      await updateAsset.mutateAsync({ assetId: asset.id, originalFilename: filename })
      notifyFileUpdated()
    } catch (error) {
      toast.error("Could not apply the title", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      })
    }
  }

  if (!hasTranscript) {
    return (
      <div
        className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-center"
        data-testid="ai-title-needs-transcript"
      >
        <p className="text-[12.5px] text-muted-foreground">
          Generate a transcript first to create an AI title.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-3 h-8 gap-1.5 text-[12px]"
          onClick={onGenerateTranscript}
        >
          <Sparkles className="size-3.5" />
          Generate Transcript
        </Button>
      </div>
    )
  }

  const busy = suggest.isPending
  const preview = selected ? titleToFilename(selected, asset.originalFilename) : null

  return (
    <div className="mt-3 space-y-3" data-testid="ai-title-section">
      {titles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
          <p className="text-[12.5px] text-muted-foreground">
            Suggest a name based on what this video says.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3 h-8 gap-1.5 bg-primary text-[12px] text-white hover:bg-primary/90"
            disabled={busy}
            onClick={() => suggest.mutate()}
            data-testid="generate-ai-title"
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
                  data-testid="ai-title-option"
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

          {/* What the file will actually be called, extension included. */}
          {preview ? (
            <p className="truncate text-[11.5px] text-muted-foreground" data-testid="ai-title-preview">
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
              data-testid="apply-ai-title"
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
              // One provider call at a time: a second click while the first is
              // in flight is a second charge for the same question.
              disabled={busy}
              onClick={() => suggest.mutate()}
              data-testid="generate-more-ai-titles"
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
