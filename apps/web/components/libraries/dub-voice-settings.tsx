"use client"

import { Settings2 } from "lucide-react"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

/**
 * Delivery, not duration.
 *
 * Every dub is fitted to the original timing regardless of this — the model is
 * always asked to fill the slot — so the choice here is how the speech is
 * carried inside that slot, which is why "Natural" rather than the old "Match
 * video timing" that implied the other two would not be matched.
 */
const PACES = [
  ["slow", "Slow"],
  ["medium", "Natural"],
  ["fast", "Fast"],
] as const

/**
 * Stands in for "no preference".
 *
 * A dropdown item cannot carry an empty value, and "Auto" is a real choice a
 * reader makes — it is translated back to `undefined` on the way out so the
 * server still does the matching.
 */
const AUTO = "auto"

/**
 * Short enough to read whole in a panel column.
 *
 * The field label carries the noun, so the value does not have to repeat it:
 * "Accent — Keep source" says what "Preserve source accent" said, and does not
 * arrive truncated to "Preserve source".
 */
const ACCENTS = [
  ["preserve-source", "Keep source"],
  ["neutral-target", "Neutral"],
  ["custom", "Custom…"],
] as const

const TEXTURES = [
  [AUTO, "Auto"],
  ["soft", "Soft"],
  ["clear", "Clear"],
  ["warm", "Warm"],
  ["breathy", "Breathy"],
  ["gravelly", "Gravelly"],
  ["bright", "Bright"],
  ["firm", "Firm"],
  ["smooth", "Smooth"],
] as const

/** Test ids and React keys need a speaker label without spaces. */
const slug = (speakerId: string) => speakerId.replace(/\s+/g, "-")

/** The provider's voices, with "Auto" first because it is the default. */
const VOICE_OPTIONS = [
  [AUTO, "Auto — recommended"],
  ...GEMINI_VOICES.map((voice) => [voice.name, `${voice.name} — ${voice.character}`] as const),
] as const

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

const triggerClass =
  "mt-1 h-9 w-full min-w-0 rounded-lg border-border bg-muted/40 text-left text-[12.5px] text-foreground hover:bg-muted/70 focus-visible:ring-primary/25"

const contentClass =
  "z-[220] max-h-64 rounded-xl border border-border bg-popover text-foreground shadow-lg"

/**
 * A labelled dropdown, sized for a panel column.
 *
 * The app's own Select rather than a bare `<select>`: a browser-chrome dropdown
 * beside these controls reads as a different application, and its fixed width
 * clipped longer labels — "Match video timing" arrived as "Match video timin".
 */
function Choice({
  label,
  value,
  onValueChange,
  options,
  disabled,
  testId,
}: {
  label: string
  value: string
  onValueChange: (value: string) => void
  options: readonly (readonly [string, string])[]
  disabled?: boolean
  testId: string
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger size="default" className={triggerClass} data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" side="bottom" align="start" sideOffset={6} className={contentClass}>
          {options.map(([optionValue, optionLabel]) => (
            <SelectItem
              key={optionValue}
              value={optionValue}
              className="cursor-pointer text-[12.5px]"
            >
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

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
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Settings2 className="size-3.5" aria-hidden />
        Voice settings
      </p>
      {/* Its own row: side by side, the label and three buttons both wrapped. */}
      <div className="rounded-lg bg-muted/50 p-0.5">
        <div className="grid grid-cols-3 gap-0.5" role="group" aria-label="Voice settings detail">
          {(["auto", "simple", "advanced"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onModeChange(option)}
              aria-pressed={mode === option}
              data-testid={`voice-mode-${option}`}
              className={cn(
                "rounded-md px-2 py-1.5 text-[11.5px] font-medium capitalize transition-colors",
                mode === option
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option === "auto" ? "Auto" : option}
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
            data-testid={`voice-speaker-${slug(speakerId)}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[12.5px] font-medium text-foreground">{speakerId}</p>
              {mode !== "auto" && value.selectedGeminiVoice ? (
                <span className="shrink-0 text-[11px] text-primary">
                  {value.selectedGeminiVoice}
                </span>
              ) : null}
            </div>

            {/* ── auto: what will happen, in one line ─────────────────────── */}
            {mode === "auto" ? (
              <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                Voice matched to this speaker&apos;s vocal character, source accent kept,
                original delivery followed, timed to the video.
              </p>
            ) : null}

            {/* ── simple and advanced share these four ────────────────────── */}
            {mode !== "auto" ? (
              <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-2.5">
                <Choice
                  label="Voice presentation"
                  testId={`voice-presentation-${slug(speakerId)}`}
                  disabled={disabled}
                  options={PRESENTATIONS}
                  value={value.presentation ?? "auto"}
                  onValueChange={(presentation) => set(speakerId, { presentation })}
                />

                <Choice
                  label="Vocal age style"
                  testId={`voice-age-${slug(speakerId)}`}
                  disabled={disabled}
                  options={AGE_STYLES}
                  value={value.ageStyle ?? "auto"}
                  onValueChange={(ageStyle) => set(speakerId, { ageStyle })}
                />

                <Choice
                  label="Accent"
                  testId={`voice-accent-${slug(speakerId)}`}
                  disabled={disabled}
                  options={ACCENTS}
                  value={value.accent?.kind ?? "preserve-source"}
                  onValueChange={(kind) => set(speakerId, { accent: { kind } })}
                />

                <Choice
                  label="Emotion"
                  testId={`voice-emotion-${slug(speakerId)}`}
                  disabled={disabled}
                  options={EMOTIONS}
                  value={
                    value.emotion?.kind === "preset"
                      ? (value.emotion.preset ?? "match-original")
                      : (value.emotion?.kind ?? "match-original")
                  }
                  onValueChange={(picked) =>
                    set(speakerId, {
                      emotion:
                        picked === "match-original" || picked === "neutral" || picked === "custom"
                          ? { kind: picked }
                          : { kind: "preset", preset: picked },
                    })
                  }
                />

                {/* Free text only when the reader asked for it. */}
                {value.accent?.kind === "custom" ? (
                  <div className="col-span-2">
                    <Field label="Custom accent">
                      <Input
                        className="mt-1 h-9 text-[12.5px]"
                        disabled={disabled}
                        placeholder="e.g. British English, or Indian English"
                        value={value.accent.description ?? ""}
                        onChange={(e) =>
                          set(speakerId, {
                            accent: { kind: "custom", description: e.target.value },
                          })
                        }
                        data-testid={`voice-accent-custom-${slug(speakerId)}`}
                      />
                    </Field>
                  </div>
                ) : null}

                {value.emotion?.kind === "custom" ? (
                  <div className="col-span-2">
                    <Field label="Custom emotion">
                      <Input
                        className="mt-1 h-9 text-[12.5px]"
                        disabled={disabled}
                        placeholder="e.g. quietly confident but slightly nervous"
                        value={value.emotion.description ?? ""}
                        onChange={(e) =>
                          set(speakerId, {
                            emotion: { kind: "custom", description: e.target.value },
                          })
                        }
                        data-testid={`voice-emotion-custom-${slug(speakerId)}`}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* ── advanced only ──────────────────────────────────────────── */}
            {mode === "advanced" ? (
              <div className="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-2.5 border-t border-border pt-2.5">
                <div className="col-span-2">
                  {/* The provider's actual voices, never invented ones. */}
                  <Choice
                    label="Voice"
                    testId={`voice-gemini-${slug(speakerId)}`}
                    disabled={disabled}
                    options={VOICE_OPTIONS}
                    value={value.selectedGeminiVoice ?? AUTO}
                    onValueChange={(voice) =>
                      set(speakerId, {
                        selectedGeminiVoice: voice === AUTO ? undefined : voice,
                      })
                    }
                  />
                </div>

                <Choice
                  label="Pitch guidance"
                  testId={`voice-pitch-${slug(speakerId)}`}
                  disabled={disabled}
                  options={LEVELS}
                  value={value.pitch ?? "medium"}
                  onValueChange={(pitch) => set(speakerId, { pitch })}
                />

                <Choice
                  label="Energy"
                  testId={`voice-energy-${slug(speakerId)}`}
                  disabled={disabled}
                  options={LEVELS}
                  value={value.energy ?? "medium"}
                  onValueChange={(energy) => set(speakerId, { energy })}
                />

                <Choice
                  label="Texture"
                  testId={`voice-texture-${slug(speakerId)}`}
                  disabled={disabled}
                  options={TEXTURES}
                  value={value.texture ?? AUTO}
                  onValueChange={(texture) =>
                    set(speakerId, { texture: texture === AUTO ? undefined : texture })
                  }
                />

                <Choice
                  label="Pacing"
                  testId={`voice-pace-${slug(speakerId)}`}
                  disabled={disabled}
                  options={PACES}
                  value={value.pace ?? "medium"}
                  onValueChange={(pace) => set(speakerId, { pace })}
                />

                <div className="col-span-2">
                  <Field label="Director notes">
                    <Input
                      className="mt-1 h-9 text-[12.5px]"
                      disabled={disabled}
                      placeholder="Extra direction for the performance"
                      value={value.directorNotes ?? ""}
                      onChange={(e) => set(speakerId, { directorNotes: e.target.value })}
                      data-testid={`voice-notes-${slug(speakerId)}`}
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
