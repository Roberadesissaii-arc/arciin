"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Check,
  Download,
  Loader2,
  Mic,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Volume2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { DubFailure, DubProgress } from "@/components/libraries/dub-progress"
import {
  DubVoiceSettings,
  type VoiceOverride,
  type VoiceSettingsMode,
} from "@/components/libraries/dub-voice-settings"
import {
  dubAudioUrl,
  getAssetDubs,
  isDubPlayable,
  isDubRunning,
  requestAssetDub,
  type TranscriptTranslation,
} from "@/lib/api/transcripts"
import { toast } from "@/lib/notifications/arciin-toast"
import { languageName } from "@arciin/types"
import type { AssetSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

/**
 * Generating and managing dubbed audio.
 *
 * Three rules shape this component.
 *
 * It never generates anything on its own. Switching the displayed language is
 * reading; making speech costs money, so it takes a deliberate press.
 *
 * It owns no work. The browser asks the API, the API queues a job, and the
 * worker does the separating, synthesising and mixing. This renders the
 * persisted status — which is exactly why closing the panel does not stop a
 * dub, and reopening shows the stage it actually reached.
 *
 * And it does not pretend. Separation on this host runs at roughly 13x
 * realtime, so the wait is real and is said out loud rather than hidden behind
 * a spinner that implies seconds.
 */

export const dubsQueryKey = (assetId: string) => ["asset-dubs", assetId] as const

/** While a job is running. Long enough not to hammer, short enough to feel live. */
const RUNNING_POLL_MS = 4000

export function VideoDubbing({
  asset,
  translations,
  sourceLanguage,
  onUseAudio,
  activeAudioLanguage,
  initialLanguage,
}: {
  asset: AssetSummary
  translations: TranscriptTranslation[]
  sourceLanguage: string | null
  /**
   * Which language to show first.
   *
   * Set when the reader arrived by clicking a card's running-dub indicator: they
   * asked to see *that* dub, so defaulting to the first translation instead
   * would answer a question nobody asked.
   */
  initialLanguage?: string
  /** Hands the chosen track to the player. `null` restores the original. */
  onUseAudio?: (language: string | null) => void
  activeAudioLanguage?: string | null
}) {
  const queryClient = useQueryClient()
  const [language, setLanguage] = useState<string | null>(initialLanguage ?? null)
  const [voiceMode, setVoiceMode] = useState<VoiceSettingsMode>("auto")
  /**
   * Local until Generate is pressed.
   *
   * A dropdown must never cost anything; the settings ride along with the one
   * request that does.
   */
  const [overrides, setOverrides] = useState<Record<string, VoiceOverride>>({})

  const dubsQuery = useQuery({
    queryKey: dubsQueryKey(asset.id),
    queryFn: ({ signal }) => getAssetDubs(asset.id, signal),
    // Only while something is actually running: a finished dub does not change.
    refetchInterval: (query) =>
      (query.state.data?.dubs ?? []).some((d) => isDubRunning(d.status)) ? RUNNING_POLL_MS : false,
  })

  const dubs = dubsQuery.data?.dubs ?? []
  const dubbable = new Set(dubsQuery.data?.dubbableLanguages ?? [])
  const separatorAvailable = dubsQuery.data?.separatorAvailable ?? false

  const selected = language ?? translations[0]?.language ?? null
  const selectedTranslation = selected
    ? (translations.find((t) => t.language === selected) ?? null)
    : null
  /**
   * Whoever the transcript actually named.
   *
   * Falls back to a single speaker when the transcript carried no labels —
   * inventing a second one would produce a voice for someone who never spoke.
   */
  const speakers = (() => {
    const named = [
      ...new Set((selectedTranslation?.segments ?? []).map((s) => s.speaker).filter(Boolean)),
    ] as string[]
    return named.length > 0 ? named : ["Speaker 1"]
  })()
  const dub = selected ? (dubs.find((d) => d.language === selected) ?? null) : null
  const canDub = selected ? dubbable.has(selected) : false

  const generate = useMutation({
    mutationFn: (target: string) =>
      requestAssetDub(asset.id, {
        language: target,
        // Auto sends nothing, so the server matches every speaker itself.
        ...(voiceMode === "auto" ? {} : { voiceProfiles: Object.values(overrides) }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dubsQueryKey(asset.id) })
      toast.success("Dub started", {
        description: "It keeps running if you close this panel.",
      })
    },
    onError: (error) => {
      toast.error("Could not start the dub", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      })
    },
  })

  if (translations.length === 0) {
    return (
      <div
        className="mt-3 rounded-lg border border-dashed border-border px-4 py-5 text-center"
        data-testid="dubbing-needs-translation"
      >
        <Mic className="mx-auto size-5 text-primary" />
        <p className="mt-2 text-[13px] font-medium text-foreground">Dubbing</p>
        <p className="mx-auto mt-1 max-w-[38ch] text-[12.5px] text-muted-foreground">
          Translate this video first. A dub speaks a translation aloud over the original music and
          ambience.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3" data-testid="dubbing-section">
      {/* ── which language ─────────────────────────────────────────────── */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Language
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {translations.map((translation) => {
            const current = translation.language === selected
            const existing = dubs.find((d) => d.language === translation.language)
            return (
              <button
                key={translation.language}
                type="button"
                onClick={() => setLanguage(translation.language)}
                data-testid={`dub-language-${translation.language}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] transition-colors",
                  current
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-foreground/85 hover:bg-muted/50",
                )}
              >
                {languageName(translation.language)}
                {existing && isDubPlayable(existing.status) ? (
                  <Check className="size-3" aria-label="Dub ready" />
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      {selected ? (
        <div className="rounded-lg border border-border p-3">
          <p className="text-[12.5px] text-muted-foreground">
            {languageName(selected)} translation ready
          </p>

          {/* A language the voice model cannot speak. Said plainly, with no
              button that could only fail. */}
          {!canDub ? (
            <p
              className="mt-2 text-[12.5px] text-muted-foreground"
              data-testid="dub-language-unsupported"
            >
              Audio dubbing is not currently supported for this language.
            </p>
          ) : !separatorAvailable ? (
            <p
              className="mt-2 flex items-start gap-1.5 text-[12.5px] text-destructive"
              data-testid="dub-separator-unavailable"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              The local audio separator is unavailable on this server, so the original music and
              ambience could not be kept.
            </p>
          ) : (
            <>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Dubbed audio
              </p>

              {!dub ? (
                <p className="mt-1 text-[12.5px] text-muted-foreground">Not generated</p>
              ) : (
                <div className="mt-1 space-y-1.5">
                  {isDubRunning(dub.status) ? <DubProgress dub={dub} /> : null}
                  {dub.status === "FAILED" ? (
                    <DubFailure
                      dub={dub}
                      retrying={generate.isPending}
                      onRetry={() => generate.mutate(dub.language)}
                    />
                  ) : null}

                  {isDubPlayable(dub.status) ? (
                    <>
                      <p className="flex items-center gap-1.5 text-[12.5px] text-foreground">
                        <Check className="size-3.5 text-primary" aria-hidden />
                        {languageName(dub.language)} dub ready
                      </p>
                      <p className="text-[11.5px] text-muted-foreground">
                        {/* From the row, not hardcoded: a dub made by another
                            provider must not claim it came from this one. */}
                        {dub.provider === "gemini"
                          ? "Generated with Gemini"
                          : `Generated with ${dub.provider ?? "an unknown provider"}`}
                        {dub.backgroundStrategy === "separated"
                          ? " · original music and ambience preserved"
                          : ""}
                      </p>
                      {/* Honest about imperfect fits rather than hiding them. */}
                      {dub.status === "NEEDS_REVIEW" ? (
                        <p
                          className="flex items-start gap-1.5 text-[11.5px] text-amber-700"
                          data-testid="dub-needs-review"
                        >
                          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                          Some segments may need timing review.
                        </p>
                      ) : null}
                      {dub.stale ? (
                        <p
                          className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11.5px] text-amber-700"
                          data-testid="dub-stale"
                        >
                          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
                          Outdated — the transcript or translation changed after this was made.
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              )}

              {/* ── how each speaker should sound ─────────────────────── */}
              <div className="mt-3 border-t border-border pt-3">
                <DubVoiceSettings
                  speakers={speakers}
                  mode={voiceMode}
                  onModeChange={setVoiceMode}
                  overrides={overrides}
                  onChange={(speakerId, patch) =>
                    setOverrides((current) => ({
                      ...current,
                      [speakerId]: { ...(current[speakerId] ?? { speakerId }), ...patch, speakerId },
                    }))
                  }
                  disabled={generate.isPending || (dub ? isDubRunning(dub.status) : false)}
                />
              </div>

              {/* ── actions ───────────────────────────────────────────── */}
              <div className="mt-3 flex flex-wrap gap-2">
                {!dub || dub.status === "FAILED" ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={generate.isPending}
                    onClick={() => generate.mutate(selected)}
                    data-testid="generate-dub"
                  >
                    {generate.isPending ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Mic className="size-3.5" />
                    )}
                    Generate {languageName(selected)} dub
                  </Button>
                ) : null}

                {dub && isDubPlayable(dub.status) ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant={activeAudioLanguage === dub.language ? "default" : "outline"}
                      onClick={() =>
                        onUseAudio?.(activeAudioLanguage === dub.language ? null : dub.language)
                      }
                      data-testid="use-dub-audio"
                    >
                      <Volume2 className="size-3.5" />
                      {activeAudioLanguage === dub.language
                        ? "Using this audio"
                        : `Use ${languageName(dub.language)} audio`}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={generate.isPending}
                      onClick={() => generate.mutate(dub.language)}
                      data-testid="regenerate-dub"
                    >
                      <RefreshCw className="size-3.5" />
                      Regenerate
                    </Button>
                    <Button asChild type="button" size="sm" variant="outline">
                      <a
                        href={dubAudioUrl(asset.id, dub.language)}
                        download
                        data-testid="download-dub-audio"
                      >
                        <Download className="size-3.5" />
                        Download audio
                      </a>
                    </Button>
                  </>
                ) : null}
              </div>

              {/* The "this takes a while, and it keeps going" notice now lives
                  beside the progress bar in DubProgress, where the reader is
                  already looking. Repeating it here said the same thing twice. */}
            </>
          )}
        </div>
      ) : null}

      {/* ── where the work happens ─────────────────────────────────────── */}
      <details className="rounded-lg border border-border px-3 py-2" data-testid="dub-privacy">
        <summary className="cursor-pointer text-[12px] text-muted-foreground">
          What leaves this server
        </summary>
        <dl className="mt-2 space-y-1 text-[11.5px]">
          <div className="flex items-start gap-1.5">
            <ShieldCheck className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden />
            <span className="text-muted-foreground">
              <span className="text-foreground">Audio separation</span> — local. The video and its
              soundtrack stay here.
            </span>
          </div>
          <div className="flex items-start gap-1.5">
            <Volume2 className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">
              <span className="text-foreground">Voice generation</span> — Gemini receives the
              translated text and the performance directions, and returns audio. The video is never
              uploaded to it.
            </span>
          </div>
          {sourceLanguage ? (
            <div className="text-muted-foreground">
              Source language: {languageName(sourceLanguage)}
            </div>
          ) : null}
        </dl>
      </details>
    </div>
  )
}
