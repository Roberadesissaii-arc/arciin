/**
 * Turning the speech in a media asset into a timestamped transcript.
 *
 * The service boundary the UI talks to. A drawer button knows only
 * "transcribe this asset"; whether that goes through the Files API or an inline
 * part, whether the audio was extracted first, and which model answered are all
 * decisions that live here and can change without touching a component.
 *
 * Named for media rather than video on purpose: nothing below cares that the
 * source was an `.mp4`. An audio library would reuse it as-is.
 */

import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { execa } from "execa"
import {
  normalizeTranscriptSegments,
  transcriptToPlainText,
  type TranscriptSegment,
} from "@arciin/types"

import {
  runGeminiMediaUnderstanding,
  type GeminiMediaConfig,
} from "./gemini-media-provider"

/**
 * What the model is asked for, in the terms that matter.
 *
 * Every line here is a failure mode someone has seen from a transcription
 * prompt: models summarise when not told not to, translate to English unless
 * forbidden, invent plausible words over inaudible passages, and name speakers
 * they cannot possibly know.
 */
export const TRANSCRIPTION_PROMPT = `Transcribe all intelligible spoken audio in this media.

Rules:
- Transcribe what is actually said. Do NOT summarise, paraphrase, or shorten.
- Keep the spoken language exactly as spoken. Do NOT translate. If several languages are spoken, transcribe each part in its own language.
- Do NOT invent speech. If a passage is inaudible or unclear, write [inaudible] for that part rather than guessing.
- Break the transcript into short segments at natural pauses or speaker changes.
- Give each segment the time it starts, measured from the beginning of the media.
- Separate speakers only when you can genuinely tell voices apart. Label them "Speaker 1", "Speaker 2", and so on. Never use a real name unless a speaker is clearly named in the audio, and never guess who someone is.
- If there is no speech at all, return an empty segment list.

Report the language you heard as a BCP-47 tag (for example "en", "am", "es").`

/** Structured output beats parsing prose the model felt like formatting. */
export const TRANSCRIPT_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    language: {
      type: "string",
      description: "BCP-47 tag of the main spoken language, e.g. en, am, es.",
    },
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          startMs: { type: "integer", description: "Start time in milliseconds." },
          endMs: { type: "integer", description: "End time in milliseconds." },
          speaker: {
            type: "string",
            description: 'Optional. "Speaker 1", "Speaker 2"… Omit when unsure.',
          },
          text: { type: "string", description: "Exactly what was said." },
        },
        required: ["startMs", "text"],
      },
    },
  },
  required: ["segments"],
} as const

export type TranscribeMediaResult =
  | {
      ok: true
      language: string | null
      segments: TranscriptSegment[]
      fullText: string
      model: string
      durationSeconds: number | null
    }
  | { ok: false; reason: "no_audio" | "no_speech" | "error"; message: string }

export type TranscribeMediaInput = {
  config: GeminiMediaConfig
  /** The stored media file. */
  filePath: string
  mimeType: string
  onStage?: (stage: "preparing" | "uploading" | "analyzing") => void
  signal?: AbortSignal
}

type ProbeResult = { hasAudio: boolean; durationSeconds: number | null }

/** Does this file actually contain speech to transcribe? */
export async function probeMediaAudio(filePath: string): Promise<ProbeResult> {
  try {
    const { stdout } = await execa("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type:format=duration",
      "-of",
      "json",
      filePath,
    ])
    const parsed = JSON.parse(stdout) as {
      streams?: { codec_type?: string }[]
      format?: { duration?: string }
    }
    const hasAudio = (parsed.streams ?? []).some((s) => s.codec_type === "audio")
    const duration = Number(parsed.format?.duration)
    return {
      hasAudio,
      durationSeconds: Number.isFinite(duration) ? duration : null,
    }
  } catch {
    // A probe failure is not proof there is no audio — let the attempt proceed
    // and report a real error if the media is genuinely unusable.
    return { hasAudio: true, durationSeconds: null }
  }
}

/**
 * Extract just the speech track, as compact mono audio.
 *
 * A transcript needs the audio, not the pixels. A one-hour 1080p recording is
 * gigabytes of video wrapped around a few megabytes of speech, and uploading
 * the whole thing costs the user transfer, latency and tokens for frames the
 * task never looks at. 16 kHz mono is what speech models want anyway.
 *
 * ffmpeg is already a dependency here — the same binary generates video
 * thumbnails — so this adds no new infrastructure.
 */
async function extractAudio(filePath: string): Promise<{ audioPath: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "arciin-transcribe-"))
  const audioPath = path.join(dir, "audio.m4a")
  await execa("ffmpeg", [
    "-y",
    "-i",
    filePath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "aac",
    "-b:a",
    "64k",
    audioPath,
  ])
  return {
    audioPath,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  }
}

/**
 * Transcribe one media file.
 *
 * Returns a typed refusal rather than throwing for the two outcomes that are
 * facts about the media rather than faults: no audio track, and audio with no
 * speech in it. Both deserve their own message in the drawer.
 */
export async function transcribeMedia(
  input: TranscribeMediaInput,
): Promise<TranscribeMediaResult> {
  input.onStage?.("preparing")

  const probe = await probeMediaAudio(input.filePath)
  if (!probe.hasAudio) {
    return {
      ok: false,
      reason: "no_audio",
      message: "This video doesn't appear to contain an audio track.",
    }
  }

  let sendPath = input.filePath
  let sendMime = input.mimeType
  let cleanup: (() => Promise<void>) | null = null

  try {
    try {
      const extracted = await extractAudio(input.filePath)
      sendPath = extracted.audioPath
      sendMime = "audio/mp4"
      cleanup = extracted.cleanup
    } catch {
      // ffmpeg could not read it. Gemini understands video directly, so fall
      // back to sending the original rather than failing outright.
      sendPath = input.filePath
      sendMime = input.mimeType
    }

    const size = await stat(sendPath).then((s) => s.size).catch(() => 0)
    if (size === 0) {
      return { ok: false, reason: "error", message: "The media file is empty or unreadable." }
    }

    const response = await runGeminiMediaUnderstanding({
      config: input.config,
      filePath: sendPath,
      mimeType: sendMime,
      prompt: TRANSCRIPTION_PROMPT,
      responseSchema: TRANSCRIPT_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      onStage: input.onStage,
      signal: input.signal,
    })

    let parsed: { language?: unknown; segments?: unknown }
    try {
      parsed = JSON.parse(response.text) as { language?: unknown; segments?: unknown }
    } catch {
      // Structured output failed. Inventing a transcript to fill the UI would
      // be worse than saying so.
      return {
        ok: false,
        reason: "error",
        message: "The transcript came back in an unreadable format. Try again.",
      }
    }

    const segments = normalizeTranscriptSegments(parsed.segments)
    if (segments.length === 0) {
      return {
        ok: false,
        reason: "no_speech",
        message: "No intelligible speech was detected in this media.",
      }
    }

    const language =
      typeof parsed.language === "string" && parsed.language.trim()
        ? parsed.language.trim()
        : null

    return {
      ok: true,
      language,
      segments,
      fullText: transcriptToPlainText(segments),
      model: response.model,
      durationSeconds: probe.durationSeconds,
    }
  } finally {
    if (cleanup) await cleanup().catch(() => {})
  }
}
