"use client"

import { Settings2 } from "lucide-react"

import { Input } from "@/components/ui/input"
import { GEMINI_VOICES } from "@arciin/types"
import { cn } from "@/lib/utils"

/**
 * Choosing how each speaker sounds.
 *
 * Three modes because the audience is three audiences. Most people want the
 * recommendation and nothing else; some want to nudge one thing; a few want the
 * exact voice and their own direction. Showing all twenty controls by default
 * would serve only the third group.
 *
 * The vocabulary is deliberate throughout. These fields describe *vocal
 * character* — what a voice sounds like — and never claim anything about a
 * speaker's real age, gender or nationality. Arciin cannot know that from an
 * audio track, and saying otherwise would be both wrong and none of its
 * business. Nothing here is voice cloning either: these are the provider's
 * prebuilt voices, matched approximately.
 *
 * Changing a control costs nothing. Only Generate and Regenerate spend money,
 * which is why every field here is local state until one of those is pressed.
 */

export type VoiceSettingsMode = "auto" | "simple" | "advanced"

/** Mirrors the server's VoiceProfile overrides. Every field optional. */
export type VoiceOverride = {
  speakerId: string
  presentation?: string
  ageStyle?: string
  pitch?: string
  energy?: string
  pace?: string
  texture?: string
  selectedGeminiVoice?: string
  accent?: { kind: string; description?: string }
  emotion?: { kind: string; preset?: string; description?: string }
  directorNotes?: string
}

const PRESENTATIONS = [
  ["auto", "Auto"],
  ["masculine", "Masculine"],
  ["feminine", "Feminine"],
  ["neutral", "Neutral"],
] as const

const AGE_STYLES = [
  ["auto", "Auto"],
  ["youthful", "Youthful"],
  ["young-adult", "Young adult"],
  ["adult", "Adult"],
  ["mature", "Mature"],
] as const

const EMOTIONS = [
  ["match-original", "Match original"],
  ["neutral", "Neutral"],
  ["happy", "Happy"],
  ["excited", "Excited"],
  ["serious", "Serious"],
  ["sad", "Sad"],
  ["angry", "Angry"],
  ["calm", "Calm"],
  ["tired", "Tired"],
  ["custom", "Custom…"],
] as const

const LEVELS = [
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
] as const

const PACES = [
  ["slow", "Slow"],
  ["medium", "Match video timing"],
  ["fast", "Fast"],
] as const

const TEXTURES = [
  ["", "Auto"],
  ["soft", "Soft"],
  ["clear", "Clear"],
  ["warm", "Warm"],
  ["breathy", "Breathy"],
  ["gravelly", "Gravelly"],
  ["bright", "Bright"],
  ["firm", "Firm"],
  ["smooth", "Smooth"],
] as const

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

const selectClass =
  "mt-1 h-8 w-full rounded-md border border-border bg-card px-2 text-[12.5px] text-foreground"

export function DubVoiceSettings({
  speakers,
  mode,
  onModeChange,
  overrides,
  onChange,
  disabled = false,
}: {
  /** Speaker labels from the transcript, e.g. ["Speaker 1", "Speaker 2"]. */
  speakers: string[]
  mode: VoiceSettingsMode
  onModeChange: (mode: VoiceSettingsMode) => void
  overrides: Record<string, VoiceOverride>
  onChange: (speakerId: string, patch: Partial<VoiceOverride>) => void
  disabled?: boolean
}) {
  const set = (speakerId: string, patch: Partial<VoiceOverride>) => onChange(speakerId, patch)

  return (
    <div className="space-y-2" data-testid="dub-voice-settings">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Settings2 className="size-3.5" aria-hidden />
          Voice settings
        </p>
        <div className="flex gap-0.5" role="group" aria-label="Voice settings detail">
          {(["auto", "simple", "advanced"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onModeChange(option)}
              aria-pressed={mode === option}
              data-testid={`voice-mode-${option}`}
              className={cn(
                "rounded-md px-2 py-1 text-[11.5px] font-medium capitalize transition-colors",
                mode === option
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted/60",
              )}
            >
              {option === "auto" ? "Auto match" : option}
            </button>
          ))}
        </div>
      </div>

      {speakers.map((speakerId) => {
        const value = overrides[speakerId] ?? { speakerId }
        return (
          <div
            key={speakerId}
            className="rounded-lg border border-border p-2.5"
            data-testid={`voice-speaker-${speakerId.replace(/\s+/g, "-")}`}
          >
            <p className="text-[12.5px] font-medium text-foreground">{speakerId}</p>

            {/* ── auto: the recommendation, and nothing to fiddle with ───── */}
            {mode === "auto" ? (
              <dl className="mt-1.5 grid grid-cols-[92px_1fr] gap-x-2 gap-y-1 text-[11.5px]">
                <dt className="text-muted-foreground">Matched</dt>
                <dd className="text-foreground">
                  Automatically, from the speaker&apos;s vocal character
                </dd>
                <dt className="text-muted-foreground">Accent</dt>
                <dd className="text-foreground">Preserve source</dd>
                <dt className="text-muted-foreground">Emotion</dt>
                <dd className="text-foreground">Match original</dd>
                <dt className="text-muted-foreground">Pacing</dt>
                <dd className="text-foreground">Match video timing</dd>
              </dl>
            ) : null}

            {/* ── simple and advanced share these four ────────────────────── */}
            {mode !== "auto" ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Voice presentation">
                  <select
                    className={selectClass}
                    disabled={disabled}
                    value={value.presentation ?? "auto"}
                    onChange={(e) => set(speakerId, { presentation: e.target.value })}
                    data-testid={`voice-presentation-${speakerId.replace(/\s+/g, "-")}`}
                  >
                    {PRESENTATIONS.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Vocal age style">
                  <select
                    className={selectClass}
                    disabled={disabled}
                    value={value.ageStyle ?? "auto"}
                    onChange={(e) => set(speakerId, { ageStyle: e.target.value })}
                    data-testid={`voice-age-${speakerId.replace(/\s+/g, "-")}`}
                  >
                    {AGE_STYLES.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Accent">
                  <select
                    className={selectClass}
                    disabled={disabled}
                    value={value.accent?.kind ?? "preserve-source"}
                    onChange={(e) => set(speakerId, { accent: { kind: e.target.value } })}
                    data-testid={`voice-accent-${speakerId.replace(/\s+/g, "-")}`}
                  >
                    <option value="preserve-source">Preserve source accent</option>
                    <option value="neutral-target">Neutral target-language accent</option>
                    <option value="custom">Custom…</option>
                  </select>
                </Field>

                <Field label="Emotion">
                  <select
                    className={selectClass}
                    disabled={disabled}
                    value={
                      value.emotion?.kind === "preset"
                        ? (value.emotion.preset ?? "match-original")
                        : (value.emotion?.kind ?? "match-original")
                    }
                    onChange={(e) => {
                      const picked = e.target.value
                      set(speakerId, {
                        emotion:
                          picked === "match-original" || picked === "neutral" || picked === "custom"
                            ? { kind: picked }
                            : { kind: "preset", preset: picked },
                      })
                    }}
                    data-testid={`voice-emotion-${speakerId.replace(/\s+/g, "-")}`}
                  >
                    {EMOTIONS.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* Free text only when the reader asked for it. */}
                {value.accent?.kind === "custom" ? (
                  <div className="col-span-2">
                    <Field label="Custom accent">
                      <Input
                        className="mt-1 h-8 text-[12.5px]"
                        disabled={disabled}
                        placeholder="e.g. British English, or Indian English — Mumbai"
                        value={value.accent.description ?? ""}
                        onChange={(e) =>
                          set(speakerId, {
                            accent: { kind: "custom", description: e.target.value },
                          })
                        }
                        data-testid={`voice-accent-custom-${speakerId.replace(/\s+/g, "-")}`}
                      />
                    </Field>
                  </div>
                ) : null}

                {value.emotion?.kind === "custom" ? (
                  <div className="col-span-2">
                    <Field label="Custom emotion">
                      <Input
                        className="mt-1 h-8 text-[12.5px]"
                        disabled={disabled}
                        placeholder="e.g. quietly confident but slightly nervous"
                        value={value.emotion.description ?? ""}
                        onChange={(e) =>
                          set(speakerId, {
                            emotion: { kind: "custom", description: e.target.value },
                          })
                        }
                        data-testid={`voice-emotion-custom-${speakerId.replace(/\s+/g, "-")}`}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ── advanced only ──────────────────────────────────────────── */}
            {mode === "advanced" ? (
              <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-2">
                <div className="col-span-2">
                  <Field label="Gemini voice">
                    <select
                      className={selectClass}
                      disabled={disabled}
                      value={value.selectedGeminiVoice ?? ""}
                      onChange={(e) =>
                        set(speakerId, { selectedGeminiVoice: e.target.value || undefined })
                      }
                      data-testid={`voice-gemini-${speakerId.replace(/\s+/g, "-")}`}
                    >
                      <option value="">Auto — recommended</option>
                      {/* The provider's actual voices, never invented ones. */}
                      {GEMINI_VOICES.map((voice) => (
                        <option key={voice.name} value={voice.name}>
                          {voice.name} — {voice.character}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="Pitch guidance">
                  <select
                    className={selectClass}
                    disabled={disabled}
                    value={value.pitch ?? "medium"}
                    onChange={(e) => set(speakerId, { pitch: e.target.value })}
                    data-testid={`voice-pitch-${speakerId.replace(/\s+/g, "-")}`}
                  >
                    {LEVELS.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Energy">
                  <select
                    className={selectClass}
                    disabled={disabled}
                    value={value.energy ?? "medium"}
                    onChange={(e) => set(speakerId, { energy: e.target.value })}
                    data-testid={`voice-energy-${speakerId.replace(/\s+/g, "-")}`}
                  >
                    {LEVELS.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Texture">
                  <select
                    className={selectClass}
                    disabled={disabled}
                    value={value.texture ?? ""}
                    onChange={(e) => set(speakerId, { texture: e.target.value || undefined })}
                    data-testid={`voice-texture-${speakerId.replace(/\s+/g, "-")}`}
                  >
                    {TEXTURES.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Pacing">
                  <select
                    className={selectClass}
                    disabled={disabled}
                    value={value.pace ?? "medium"}
                    onChange={(e) => set(speakerId, { pace: e.target.value })}
                    data-testid={`voice-pace-${speakerId.replace(/\s+/g, "-")}`}
                  >
                    {PACES.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="col-span-2">
                  <Field label="Director notes">
                    <Input
                      className="mt-1 h-8 text-[12.5px]"
                      disabled={disabled}
                      placeholder="Extra direction for the performance"
                      value={value.directorNotes ?? ""}
                      onChange={(e) => set(speakerId, { directorNotes: e.target.value })}
                      data-testid={`voice-notes-${speakerId.replace(/\s+/g, "-")}`}
                    />
                  </Field>
                </div>
              </div>
            ) : null}
          </div>
        )
      })}

      {mode !== "auto" ? (
        <p className="text-[11px] text-muted-foreground">
          Changing these costs nothing. Only Generate or Regenerate creates audio.
        </p>
      ) : null}
    </div>
  )
}
