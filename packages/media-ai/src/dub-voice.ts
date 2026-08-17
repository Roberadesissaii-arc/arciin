import { GEMINI_VOICES, NEUTRAL_VOICE, type GeminiVoiceName } from "@arciin/types"

export { GEMINI_VOICES, NEUTRAL_VOICE }
export type { GeminiVoiceName }

/**
 * Choosing a synthetic voice for a speaker in a dub.
 *
 * The vocabulary here is deliberate. A `VoiceProfile` describes *vocal
 * character* — the qualities you would use to pick a voice from a library — and
 * makes no claim about anyone's age, gender, nationality or identity. Arciin
 * cannot know those things from an audio track, and asserting them would be
 * both wrong and none of its business.
 *
 * Nor is any of this voice cloning: these are Gemini's prebuilt voices, matched
 * approximately. The UI says "match vocal character" for that reason.
 */



export type VocalPresentation = "masculine" | "feminine" | "neutral" | "auto"
export type VocalAgeStyle = "youthful" | "young-adult" | "adult" | "mature" | "auto"
export type VocalLevel = "low" | "medium" | "high"
/** Pace reads in its own vocabulary — "low pace" means nothing to anyone. */
export type VocalPace = "slow" | "medium" | "fast"
export type VocalTexture =
  | "soft"
  | "clear"
  | "warm"
  | "breathy"
  | "gravelly"
  | "bright"
  | "firm"
  | "smooth"

export type AccentMode =
  | { kind: "preserve-source" }
  | { kind: "neutral-target" }
  | { kind: "custom"; description: string }

export type EmotionMode =
  | { kind: "match-original" }
  | { kind: "neutral" }
  | { kind: "preset"; preset: string }
  | { kind: "custom"; description: string }

/**
 * How one speaker should be synthesised.
 *
 * `auto` everywhere is the default, and means "let the analysis decide". A
 * reader who cares about one field overrides that field only.
 */
export type VoiceProfile = {
  speakerId: string
  presentation: VocalPresentation
  ageStyle: VocalAgeStyle
  pitch: VocalLevel
  energy: VocalLevel
  pace: VocalPace
  texture?: VocalTexture
  /** 0–1. Higher permits more performance direction. */
  expressiveness?: number
  /** Chosen by `matchVoice`, or forced by the reader. */
  selectedGeminiVoice: GeminiVoiceName
  accent: AccentMode
  emotion: EmotionMode
  /** How confident the automatic match was — surfaced, never hidden. */
  confidence?: "low" | "medium" | "high"
  /** The reader's own direction, in their words. Free text, so sanitised. */
  directorNotes?: string
}

/** What an analyser can say about a speaker's sound. Every field optional. */
export type VocalAnalysis = {
  speakerId: string
  pitch?: VocalLevel
  energy?: VocalLevel
  pace?: VocalPace
  texture?: VocalTexture
  ageStyle?: VocalAgeStyle
  presentation?: VocalPresentation
}

/**
 * Pick the closest voice for an observed vocal character.
 *
 * Scored, not random and not first-match: pitch and energy carry the most
 * weight because they are what a listener notices immediately, texture refines
 * between otherwise-similar candidates. Ties break alphabetically so the same
 * analysis always yields the same voice — a dub regenerated with unchanged
 * settings should not quietly change voice.
 */
export function matchVoice(analysis: VocalAnalysis): {
  voice: GeminiVoiceName
  confidence: "low" | "medium" | "high"
} {
  const known = [analysis.pitch, analysis.energy, analysis.texture].filter(Boolean).length
  if (known === 0) {
    // Nothing to go on. A neutral voice is honest; a guess is not.
    return { voice: NEUTRAL_VOICE, confidence: "low" }
  }

  let best: { name: GeminiVoiceName; score: number } | null = null
  for (const candidate of [...GEMINI_VOICES].sort((a, b) => a.name.localeCompare(b.name))) {
    let score = 0
    if (analysis.pitch && candidate.pitch === analysis.pitch) score += 3
    if (analysis.energy && candidate.energy === analysis.energy) score += 2
    if (analysis.texture && candidate.texture === analysis.texture) score += 2
    // A mature character reads lower and warmer; youthful reads higher, brighter.
    if (analysis.ageStyle === "mature" && candidate.pitch === "low") score += 1
    if (analysis.ageStyle === "youthful" && candidate.pitch === "high") score += 1
    if (!best || score > best.score) best = { name: candidate.name, score }
  }

  const voice = best?.name ?? NEUTRAL_VOICE
  const confidence = known >= 3 ? "high" : known === 2 ? "medium" : "low"
  return { voice, confidence }
}

/** A complete profile from whatever the analysis managed to observe. */
export function buildVoiceProfile(
  analysis: VocalAnalysis,
  overrides: Partial<VoiceProfile> = {},
): VoiceProfile {
  const matched = matchVoice(analysis)
  return {
    speakerId: analysis.speakerId,
    presentation: overrides.presentation ?? analysis.presentation ?? "auto",
    ageStyle: overrides.ageStyle ?? analysis.ageStyle ?? "auto",
    pitch: overrides.pitch ?? analysis.pitch ?? "medium",
    energy: overrides.energy ?? analysis.energy ?? "medium",
    pace: overrides.pace ?? analysis.pace ?? "medium",
    ...(overrides.texture ?? analysis.texture
      ? { texture: overrides.texture ?? analysis.texture }
      : {}),
    ...(overrides.expressiveness !== undefined
      ? { expressiveness: overrides.expressiveness }
      : {}),
    // An explicit choice always wins over the match.
    selectedGeminiVoice: overrides.selectedGeminiVoice ?? matched.voice,
    accent: cleanAccent(overrides.accent),
    emotion: cleanEmotion(overrides.emotion),
    ...(sanitizeDirectorNotes(overrides.directorNotes)
      ? { directorNotes: sanitizeDirectorNotes(overrides.directorNotes) }
      : {}),
    confidence: overrides.selectedGeminiVoice ? "high" : matched.confidence,
  }
}

/**
 * A described accent with nothing usable left in the description is not a
 * described accent — it falls back rather than directing the model at "".
 */
function cleanAccent(accent: AccentMode | undefined): AccentMode {
  if (!accent) return { kind: "preserve-source" }
  if (accent.kind === "custom") {
    const description = sanitizePromptText(accent.description, 200)
    return description ? { kind: "custom", description } : { kind: "preserve-source" }
  }
  return { kind: accent.kind }
}

function cleanEmotion(emotion: EmotionMode | undefined): EmotionMode {
  if (!emotion) return { kind: "match-original" }
  if (emotion.kind === "custom") {
    const description = sanitizePromptText(emotion.description, 200)
    return description ? { kind: "custom", description } : { kind: "match-original" }
  }
  if (emotion.kind === "preset") {
    const preset = sanitizePromptText(emotion.preset, 60)
    return preset ? { kind: "preset", preset } : { kind: "match-original" }
  }
  return { kind: emotion.kind }
}

/**
 * Clean a reader's free-text direction before it reaches a prompt.
 *
 * This is the one field in a dub that a person types by hand, and it lands in
 * the same prompt as the words to be spoken. Someone typing the speech markers —
 * whether probing or by accident — would otherwise close the fence early and
 * turn the rest of their note into dialogue the dub reads aloud. So the markers
 * come out, newlines collapse to keep it a single bullet, and the length is
 * capped: direction that runs longer than the script stops being direction.
 */
export function sanitizeDirectorNotes(input: string | undefined | null): string | undefined {
  return sanitizePromptText(input, 400)
}

/** The same guard for every other free-text field that reaches a prompt. */
export function sanitizePromptText(
  input: string | undefined | null,
  maxLength: number,
): string | undefined {
  if (!input) return undefined
  const cleaned = input
    // The fence, however it was typed.
    .replace(/<<<\s*\/?\s*(SPEAK|END)\s*>>>/gi, " ")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
  return cleaned || undefined
}

/**
 * Human wording for a profile: "Mature · warm · medium-low".
 *
 * Says "vocal character", never anything about the person.
 */
export function describeVocalCharacter(profile: VoiceProfile): string {
  const parts = [
    profile.ageStyle !== "auto" ? profile.ageStyle.replace("-", " ") : null,
    profile.texture ?? null,
    profile.pitch === "medium" ? null : `${profile.pitch} pitch`,
    profile.energy === "high" ? "high energy" : profile.energy === "low" ? "calm" : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : "even, general-purpose"
}

/**
 * A stable fingerprint of everything that would change the audio.
 *
 * Stored on the dub so a settings change can be told apart from "same settings,
 * pressed regenerate" — the first invalidates the existing audio, the second
 * should reproduce it.
 */
export function voiceSettingsFingerprint(profiles: VoiceProfile[]): string {
  const normalized = [...profiles]
    .sort((a, b) => a.speakerId.localeCompare(b.speakerId))
    .map((p) => [
      p.speakerId,
      p.selectedGeminiVoice,
      p.presentation,
      p.ageStyle,
      p.pitch,
      p.energy,
      p.pace,
      p.texture ?? "-",
      p.accent.kind + ("description" in p.accent ? `:${p.accent.description}` : ""),
      p.emotion.kind +
        ("description" in p.emotion
          ? `:${p.emotion.description}`
          : "preset" in p.emotion
            ? `:${p.emotion.preset}`
            : ""),
      // Part of the fingerprint: changing the direction changes the audio.
      p.directorNotes ?? "-",
    ].join("|"))
  return normalized.join("~")
}
