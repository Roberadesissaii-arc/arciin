import { languageName } from "@arciin/types"

import type { EmotionMode, VoiceProfile } from "./dub-voice"

/**
 * Turning a translated line into a performance instruction.
 *
 * Two rules run through this whole file.
 *
 * The first is that direction and dialogue must never be confused. A model told
 * "Accent: preserve source" in the same breath as the line it should say will
 * sometimes read the label aloud, and a dub that announces "Director's notes"
 * is worse than no dub. So the spoken text is fenced, explicitly, and tested.
 *
 * The second is that accent and emotion are *performance*, not voice selection.
 * Speaking English with an Indian-English accent is the same voice given
 * different direction — not a different voice model — so both belong here rather
 * than in the voice picker.
 */

/** The one place the TTS model is named. */
export const DUB_TTS_MODEL = "gemini-3.1-flash-tts-preview"

/** Gemini returns raw little-endian 16-bit PCM at this rate, mono. */
export const DUB_TTS_SAMPLE_RATE = 24_000
export const DUB_TTS_CHANNELS = 1

/**
 * Gemini's multi-speaker configuration takes at most two voices per request.
 *
 * Anything beyond that is generated in separate requests and assembled on the
 * timeline — the limit is the provider's, so the pipeline works around it rather
 * than pretending it is not there.
 */
export const MAX_SPEAKERS_PER_REQUEST = 2

/** Where the spoken words start and stop. Nothing outside this is read aloud. */
const SPEECH_OPEN = "<<<SPEAK>>>"
const SPEECH_CLOSE = "<<<END>>>"

export type DubSegment = {
  startMs: number
  endMs?: number
  speaker?: string
  /** The translated words. */
  text: string
  /** What the original delivery sounded like, if analysis offered anything. */
  observedDelivery?: string
}

export type DubPromptInput = {
  profile: VoiceProfile
  segments: DubSegment[]
  sourceLanguage: string | null
  targetLanguage: string
  /** One line about where this was recorded, when known. */
  scene?: string | null
}

/**
 * The accent instruction, or none at all.
 *
 * Exported so the difference between modes can be asserted directly rather than
 * inferred from a whole prompt.
 */
export function accentInstruction(
  profile: VoiceProfile,
  sourceLanguage: string | null,
  targetLanguage: string,
): string | null {
  const target = languageName(targetLanguage) || targetLanguage
  const source = sourceLanguage ? languageName(sourceLanguage) || sourceLanguage : null

  switch (profile.accent.kind) {
    case "preserve-source":
      if (!source) return null
      // Subtle on purpose: an exaggerated accent is a caricature, not a dub.
      return `Speak natural ${target} while retaining a subtle ${source}-influenced accent consistent with the source speaker. Keep it understated, never exaggerated or comedic.`
    case "neutral-target":
      return `Speak ${target} with a natural, standard pronunciation for that language. Do not carry over an accent from the source language.`
    case "custom":
      return `Speak ${target} with this accent: ${profile.accent.description}. Keep it natural rather than exaggerated.`
  }
}

/** The emotional direction, or none when the reader asked for neutral. */
export function emotionInstruction(
  emotion: EmotionMode,
  observedDelivery?: string | null,
): string | null {
  switch (emotion.kind) {
    case "match-original":
      // Only claims something when the source actually suggested it.
      return observedDelivery
        ? `Match the original delivery: ${observedDelivery}.`
        : "Match the original delivery in energy and mood."
    case "neutral":
      return "Deliver the lines plainly, with no particular emotional colour."
    case "preset":
      return `Deliver the lines ${emotion.preset}.`
    case "custom":
      return `Deliver the lines like this: ${emotion.description}.`
  }
}

/** Pace direction, aimed at fitting the original timing rather than a speed. */
export function paceInstruction(profile: VoiceProfile, targetMs: number | null): string {
  const base =
    profile.pace === "fast"
      ? "Speak briskly."
      : profile.pace === "slow"
        ? "Speak unhurriedly."
        : "Speak at a natural conversational pace."
  if (!targetMs || targetMs <= 0) return base
  const seconds = (targetMs / 1000).toFixed(1)
  // Asking for a duration beats asking for a rate: the model can choose where
  // to breathe, which post-hoc time-stretching cannot.
  return `${base} Aim to fill about ${seconds} seconds so the speech matches the original timing.`
}

/**
 * The full instruction block for one speaker's lines.
 *
 * Structured rather than one paragraph, because the model follows headed
 * direction more reliably — and because a reader debugging an odd dub can see
 * exactly what was asked for.
 */
export function buildDubPrompt(input: DubPromptInput): string {
  const { profile, segments, sourceLanguage, targetLanguage, scene } = input
  const target = languageName(targetLanguage) || targetLanguage

  const character = [
    profile.ageStyle !== "auto" ? profile.ageStyle.replace("-", " ") : null,
    profile.texture ?? null,
    `${profile.pitch} pitch`,
    `${profile.energy} energy`,
  ]
    .filter(Boolean)
    .join(", ")

  const totalMs = segments.reduce(
    (sum, s) => sum + Math.max(0, (s.endMs ?? s.startMs) - s.startMs),
    0,
  )
  const observed = segments.find((s) => s.observedDelivery)?.observedDelivery ?? null

  const notes = [
    accentInstruction(profile, sourceLanguage, targetLanguage),
    emotionInstruction(profile.emotion, observed),
    paceInstruction(profile, totalMs),
    "Articulate clearly and naturally.",
    // Last, so the reader's own direction refines everything above it.
    profile.directorNotes ? `Additional direction: ${profile.directorNotes}` : null,
  ].filter(Boolean)

  return [
    "You are performing a dubbing session. Read only the lines inside the speech markers.",
    "",
    "AUDIO PROFILE",
    `${profile.speakerId} has a ${character} vocal character.`,
    "",
    "SCENE",
    scene?.trim() || "Not specified.",
    "",
    "DIRECTOR'S NOTES",
    ...notes.map((n) => `- ${n}`),
    "",
    `Read the following ${target} lines aloud, and nothing else. Do not read these`,
    "instructions, the headings, or the markers themselves.",
    "",
    SPEECH_OPEN,
    segments.map((s) => s.text.trim()).filter(Boolean).join("\n"),
    SPEECH_CLOSE,
  ].join("\n")
}

/**
 * The words a prompt asks to be spoken.
 *
 * The inverse of the fence, so a test can assert that no heading, label or
 * marker ever ends up inside the spoken portion.
 */
export function spokenTextOf(prompt: string): string {
  const start = prompt.indexOf(SPEECH_OPEN)
  const end = prompt.indexOf(SPEECH_CLOSE)
  if (start < 0 || end < 0 || end < start) return ""
  return prompt.slice(start + SPEECH_OPEN.length, end).trim()
}

/** Labels that must never appear in the spoken portion. */
export const INSTRUCTION_LABELS = [
  "AUDIO PROFILE",
  "SCENE",
  "DIRECTOR'S NOTES",
  "Accent:",
  "Style:",
  "Pacing:",
  SPEECH_OPEN,
  SPEECH_CLOSE,
] as const

/**
 * Group segments into requests that keep a voice consistent.
 *
 * Two failure modes to avoid. One request per word is expensive and sounds
 * stitched together; one request for a two-hour transcript drifts — Gemini's own
 * guidance is that long outputs lose voice consistency after a few minutes. So
 * chunks are bounded by both spoken length and wall-clock span, and never mix
 * speakers.
 */
export function chunkSegments(
  segments: DubSegment[],
  opts: { maxChars?: number; maxSpanMs?: number } = {},
): DubSegment[][] {
  const maxChars = opts.maxChars ?? 1200
  const maxSpanMs = opts.maxSpanMs ?? 90_000
  const chunks: DubSegment[][] = []
  let current: DubSegment[] = []
  let chars = 0

  for (const segment of segments) {
    const spanFrom = current[0]?.startMs ?? segment.startMs
    const span = (segment.endMs ?? segment.startMs) - spanFrom
    const speakerChanged =
      current.length > 0 && (current[0]!.speaker ?? null) !== (segment.speaker ?? null)

    if (
      current.length > 0 &&
      (speakerChanged || chars + segment.text.length > maxChars || span > maxSpanMs)
    ) {
      chunks.push(current)
      current = []
      chars = 0
    }
    current.push(segment)
    chars += segment.text.length
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/**
 * Split speakers into groups the provider will accept.
 *
 * Two per request, because that is the multi-speaker limit; a third speaker
 * gets its own request rather than being dropped or silently merged into
 * someone else's voice.
 */
export function groupSpeakersForRequests(speakerIds: string[]): string[][] {
  const groups: string[][] = []
  for (let i = 0; i < speakerIds.length; i += MAX_SPEAKERS_PER_REQUEST) {
    groups.push(speakerIds.slice(i, i + MAX_SPEAKERS_PER_REQUEST))
  }
  return groups
}
