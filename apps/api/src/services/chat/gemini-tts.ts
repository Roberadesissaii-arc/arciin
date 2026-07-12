import { DEFAULT_GEMINI_TTS_MODEL } from "@arciin/shared"
import { GoogleGenAI } from "@google/genai"

/** Gemini TTS via Interactions API (Preview). */
export const GEMINI_TTS_MODEL = DEFAULT_GEMINI_TTS_MODEL
export const DEFAULT_GEMINI_TTS_VOICE = "Kore"
export const MAX_GEMINI_TTS_CHARS = 8_000

export function wrapPcm16LeInWav(
  pcm: Buffer,
  sampleRate = 24_000,
  channels = 1,
): Buffer {
  const byteRate = sampleRate * channels * 2
  const blockAlign = channels * 2
  const dataSize = pcm.length
  const header = Buffer.alloc(44)
  header.write("RIFF", 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write("WAVE", 8)
  header.write("fmt ", 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(16, 34)
  header.write("data", 36)
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcm])
}

export async function synthesizeGeminiTts(options: {
  apiKey: string
  text: string
  voice?: string
  model?: string
}): Promise<{ audio: Buffer; mimeType: string }> {
  const trimmed = options.text.trim().slice(0, MAX_GEMINI_TTS_CHARS)
  if (!trimmed) {
    throw new Error("TTS_EMPTY_TEXT")
  }

  const client = new GoogleGenAI({ apiKey: options.apiKey })
  const interaction = await client.interactions.create({
    model: options.model ?? GEMINI_TTS_MODEL,
    input: trimmed,
    response_format: { type: "audio", mime_type: "audio/wav" },
    generation_config: {
      speech_config: [{ voice: options.voice ?? DEFAULT_GEMINI_TTS_VOICE }],
    },
  })

  const block = interaction.output_audio
  if (!block?.data) {
    throw new Error("TTS_NO_AUDIO")
  }

  const raw = Buffer.from(block.data, "base64")
  const mime = block.mime_type ?? "audio/l16"
  if (mime.includes("wav")) {
    return { audio: raw, mimeType: "audio/wav" }
  }

  const sampleRate = block.sample_rate ?? 24_000
  const channels = block.channels ?? 1
  return {
    audio: wrapPcm16LeInWav(raw, sampleRate, channels),
    mimeType: "audio/wav",
  }
}
