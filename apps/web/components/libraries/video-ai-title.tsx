"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Check, Loader2, Wand2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useUpdateAsset } from "@/hooks/use-assets"
import { friendlyAiError } from "@/lib/ai/friendly-ai-error"
import { requestTitleSuggestions } from "@/lib/api/transcripts"
import { notifyFileUpdated } from "@/lib/notifications/toast-actions"
import { toast } from "@/lib/notifications/arciin-toast"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/**
 * A name for a video, from what the video actually says.
 *
 * Suggestions never rename anything. The model proposes; applying is a separate
 * act through the same asset update the Edit form uses.
 *
 * If there is no transcript yet, Generate stays on this tab: it starts a
 * transcript in the background (like Summarize) and suggests titles when ready.
 */

/** `.mp4` from `clip.mp4` — the model is never allowed to choose this. */
function extensionOf(filename: string): string {
  const match = /\.[A-Za-z0-9]{1,8}$/.exec(filename)
  return match ? match[0] : ""
}

/**
 * A title turned into a filename, keeping the original extension.
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
  transcriptStatus,
  onGenerateTranscript,
  transcriptRunning = false,
}: {
  asset: AssetSummary
  hasTranscript: boolean
  transcriptStatus: string | null
  /** Starts a transcript without leaving this tab. */
  onGenerateTranscript: () => void
  transcriptRunning?: boolean
}) {
  const [titles, setTitles] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  /** True only when Title itself asked for a transcript — stay on this tab. */
  const [awaitingTranscript, setAwaitingTranscript] = useState(false)
  const kickedOff = useRef(false)
  /** Fire the failure toast once per failure, not once per poll. */
  const announcedFailure = useRef(false)
  const updateAsset = useUpdateAsset()

  const suggest = useMutation({
    mutationFn: () => requestTitleSuggestions(asset.id, { count: 3 }),
    onSuccess: (data) => {
      setAwaitingTranscript(false)
      kickedOff.current = false
      if (data.titles.length === 0) {
        toast.error("No titles came back", { description: "Try generating again." })
        return
      }
      setTitles(data.titles)
      setSelected(data.titles[0] ?? null)
    },
    onError: (error) => {
      setAwaitingTranscript(false)
      kickedOff.current = false
      const friendly = friendlyAiError(error, {
        title: "Could not suggest a title",
        description: "Try again in a moment.",
      })
      toast.error(friendly.title, { description: friendly.description })
    },
  })

  const transcriptFailed =
    transcriptStatus === "FAILED" ||
    transcriptStatus === "NO_AUDIO" ||
    transcriptStatus === "NO_SPEECH"

  // After Title kicked off a transcript, suggest once it is READY.
  useEffect(() => {
    if (!awaitingTranscript) return
    if (transcriptStatus !== "READY" || !hasTranscript) return
    if (suggest.isPending || kickedOff.current) return
    kickedOff.current = true
    suggest.mutate()
  }, [awaitingTranscript, hasTranscript, transcriptStatus, suggest])

  // Say so once when the background transcript fails. The spinner is already
  // gone — `waitingForTranscript` excludes a failed transcript — so there is no
  // state to unwind here, only a message to deliver.
  useEffect(() => {
    if (!transcriptFailed) {
      announcedFailure.current = false
      return
    }
    if (!awaitingTranscript || announcedFailure.current) return
    announcedFailure.current = true
    kickedOff.current = false
    const description =
      transcriptStatus === "NO_AUDIO"
        ? "This video has no audio track to title from."
        : transcriptStatus === "NO_SPEECH"
          ? "No speech was detected, so a title could not be suggested."
          : "The transcript failed. Try Generate titles again."
    toast.error("Could not prepare a transcript", { description })
  }, [awaitingTranscript, transcriptFailed, transcriptStatus])

  function startTitles() {
    if (hasTranscript && transcriptStatus === "READY") {
      suggest.mutate()
      return
    }
    // Stay on Title — same pattern as Summarize.
    setAwaitingTranscript(true)
    kickedOff.current = false
    // A transcript may already be running, started from the Transcript tab or
    // from Summarize. Queue onto that one; starting a second would duplicate
    // the work and race for the same row.
    if (!transcriptRunning) onGenerateTranscript()
  }

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

  const waitingForTranscript =
    awaitingTranscript &&
    !transcriptFailed &&
    (transcriptRunning ||
      transcriptStatus === "PENDING" ||
      transcriptStatus === "PROCESSING" ||
      !hasTranscript)

  // Idle empty state: no transcript yet, and Title did not start one.
  if (!hasTranscript && !waitingForTranscript && titles.length === 0) {
    return (
      <div
        className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-center"
        data-testid="ai-title-needs-transcript"
      >
        <Wand2 className="mx-auto size-5 text-primary" />
        <p className="mt-2 text-[13px] font-medium text-foreground">AI title</p>
        <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
          {transcriptRunning
            ? "A transcript is being prepared. Ask for titles now — they arrive as soon as it lands."
            : transcriptFailed
              ? "Transcript preparation failed. Generate titles will retry it here — you stay on Title."
              : "Suggest a short name from what this video says. Generate titles prepares a transcript in the background and stays on this tab."}
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-3"
          onClick={startTitles}
          data-testid="generate-ai-title"
        >
          <Wand2 className="size-3.5" />
          Generate titles
        </Button>
      </div>
    )
  }

  const busy = suggest.isPending || waitingForTranscript
  const preview = selected ? titleToFilename(selected, asset.originalFilename) : null

  return (
    <div className="mt-3 space-y-3" data-testid="ai-title-section">
      {waitingForTranscript ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <span>Preparing a transcript, then suggesting titles…</span>
        </div>
      ) : null}

      {suggest.isPending && !waitingForTranscript && titles.length === 0 ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border px-4 py-4 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
          <span>Thinking…</span>
        </div>
      ) : null}

      {!waitingForTranscript && !suggest.isPending && titles.length === 0 && hasTranscript ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
          <Wand2 className="mx-auto size-5 text-primary" />
          <p className="mt-2 text-[13px] font-medium text-foreground">AI title</p>
          <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
            Suggest a name from what this video says. Gemini reads the saved transcript, never the
            video again.
          </p>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={busy}
            onClick={() => suggest.mutate()}
            data-testid="generate-ai-title"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
            {busy ? "Thinking…" : "Generate titles"}
          </Button>
        </div>
      ) : null}

      {titles.length > 0 ? (
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
              disabled={busy}
              onClick={() => suggest.mutate()}
              data-testid="generate-more-ai-titles"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
              Generate more
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
