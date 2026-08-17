import { GoogleGenAI } from "@google/genai"

import type { GeminiMediaConfig } from "./gemini-media-provider"
import {
  DUB_TTS_CHANNELS,
  DUB_TTS_MODEL,
  DUB_TTS_SAMPLE_RATE,
  MAX_SPEAKERS_PER_REQUEST,
  buildDubPrompt,
  type DubPromptInput,
} from "./dub-prompt"
import type { VoiceProfile } from "./dub-voice"

/**
 * Turning director's notes into audio.
 *
 * Text goes out, PCM comes back. The video never does: Gemini's TTS endpoint
 * takes a prompt and returns speech, so the original footage and the original
 * soundtrack stay on this server. That is a property worth stating plainly
 * because it is the difference between "we synthesised words" and "we uploaded
 * someone's recording to a third party".
 */

export type SynthesisResult = {
  /** Raw little-endian 16-bit PCM, 24 kHz mono, as the provider returns it. */
  pcm: Buffer
  model: string
  /** Derived from the byte count — the provider does not report it. */
  durationMs: number
}

export class TtsEmptyResponseError extends Error {
  constructor() {
    super("The model returned no audio.")
    this.name = "TtsEmptyResponseError"
  }
}

/** How long a PCM buffer plays for, at the format the provider returns. */
export function pcmDurationMs(
  byteLength: number,
  sampleRate = DUB_TTS_SAMPLE_RATE,
  channels = DUB_TTS_CHANNELS,
): number {
  const bytesPerSample = 2
  const frames = byteLength / (bytesPerSample * channels)
  return Math.round((frames / sampleRate) * 1000)
}

/**
 * Whether a failure is worth trying again.
 *
 * Gemini's own guidance is that TTS occasionally returns nothing, and rate
 * limits and 5xx are transient by definition. A rejected prompt or a bad
 * credential is not — retrying those burns quota to receive the same answer.
 */
export function isRetryableTtsError(error: unknown): boolean {
  if (error instanceof TtsEmptyResponseError) return true
  const message = error instanceof Error ? error.message : String(error)
  if (/\b(429|500|502|503|504)\b/.test(message)) return true
  if (/rate limit|overloaded|unavailable|deadline|timeout|ECONNRESET/i.test(message)) return true
  // Anything about the request itself will fail identically next time.
  if (/API_KEY|permission|invalid argument|safety|blocked/i.test(message)) return false
  return false
}

export type SynthesizeInput = DubPromptInput & {
  config: GeminiMediaConfig
  /** Two at most — the provider's ceiling, enforced by the caller's grouping. */
  additionalSpeakers?: { profile: VoiceProfile; label: string }[]
  signal?: AbortSignal
  /** Bounded. Three attempts total by default. */
  maxAttempts?: number
  onAttempt?: (attempt: number, error?: unknown) => void
}

/**
 * Speak one chunk.
 *
 * Retries are bounded and only for failures that could plausibly succeed on a
 * second try; everything else throws immediately so a broken prompt surfaces as
 * a broken prompt rather than three identical charges and a timeout.
 */
export async function synthesizeDubChunk(input: SynthesizeInput): Promise<SynthesisResult> {
  const speakers = [
    { profile: input.profile, label: input.profile.speakerId },
    ...(input.additionalSpeakers ?? []),
  ]
  if (speakers.length > MAX_SPEAKERS_PER_REQUEST) {
    throw new Error(
      `Gemini accepts at most ${MAX_SPEAKERS_PER_REQUEST} speakers per request; got ${speakers.length}. ` +
        "Group speakers with groupSpeakersForRequests() before calling.",
    )
  }

  const prompt = buildDubPrompt(input)
  const ai = new GoogleGenAI({ apiKey: input.config.apiKey })

  const speechConfig =
    speakers.length > 1
      ? {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: speakers.map((s) => ({
              speaker: s.label,
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: s.profile.selectedGeminiVoice },
              },
            })),
          },
        }
      : {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: input.profile.selectedGeminiVoice },
          },
        }

  const maxAttempts = Math.max(1, input.maxAttempts ?? 3)
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      input.onAttempt?.(attempt)
      const response = await ai.models.generateContent({
        model: DUB_TTS_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig,
          abortSignal: input.signal,
        },
      })

      const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
      if (!data) throw new TtsEmptyResponseError()

      const pcm = Buffer.from(data, "base64")
      if (pcm.length === 0) throw new TtsEmptyResponseError()

      return { pcm, model: DUB_TTS_MODEL, durationMs: pcmDurationMs(pcm.length) }
    } catch (error) {
      lastError = error
      input.onAttempt?.(attempt, error)
      if (!isRetryableTtsError(error) || attempt === maxAttempts) throw error
      // Brief, growing pause — enough to clear a rate limit, not enough to hang
      // a job behind a provider that is simply down.
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt))
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Speech synthesis failed.")
}

/**
 * A WAV header around raw PCM.
 *
 * The provider returns headerless samples, and every tool downstream — ffmpeg,
 * a browser, a person double-clicking the file — expects a container.
 */
export function pcmToWav(
  pcm: Buffer,
  sampleRate = DUB_TTS_SAMPLE_RATE,
  channels = DUB_TTS_CHANNELS,
): Buffer {
  const bitsPerSample = 16
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8
  const header = Buffer.alloc(44)

  header.write("RIFF", 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write("data", 36)
  header.writeUInt32LE(pcm.length, 40)

  return Buffer.concat([header, pcm])
}
