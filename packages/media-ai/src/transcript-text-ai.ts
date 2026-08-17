import { GoogleGenAI } from "@google/genai"

import type { GeminiMediaConfig } from "./gemini-media-provider"

/**
 * Text-only work on a transcript that already exists.
 *
 * Translation and title suggestion both read the *saved* transcript and never
 * the media. That is not an optimisation — it is the difference between a
 * cheap request carrying a few kilobytes of text and re-uploading a video to
 * re-derive words the instance already has, which costs money and sends the
 * footage somewhere it does not need to go again.
 *
 * Deliberately no file upload path in this module: there is nothing here that
 * could accidentally reach for the bytes.
 */

/** What the caller gets back, whatever the task. */
export type TextAiResult = {
  /** Raw model text — JSON when a schema was supplied. */
  text: string
  model: string
}

async function runGeminiText(
  config: GeminiMediaConfig,
  prompt: string,
  responseSchema?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<TextAiResult> {
  const ai = new GoogleGenAI({ apiKey: config.apiKey })
  const response = await ai.models.generateContent({
    model: config.model,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      ...(responseSchema
        ? { responseMimeType: "application/json", responseSchema }
        : {}),
      abortSignal: signal,
    },
  })
  return { text: response.text ?? "", model: config.model }
}

/* ------------------------------------------------------------- translation */

export type TranslatableSegment = {
  startMs: number
  endMs?: number
  speaker?: string
  text: string
}

/**
 * One object per segment, indexed, so the reply can be matched back exactly.
 *
 * The model is asked only for words. Timings and speaker labels are carried
 * over from the original in code — asking a model to restate a timeline is
 * asking it to invent one, and a translated transcript whose timestamps drift
 * stops seeking the video correctly.
 */
export const TRANSLATION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          text: { type: "string" },
        },
        required: ["index", "text"],
      },
    },
  },
  required: ["segments"],
} as const

export function buildTranslationPrompt(
  segments: TranslatableSegment[],
  targetLanguageName: string,
  sourceLanguageName?: string | null,
): string {
  const lines = segments.map((s, i) => `${i}\t${s.text.replace(/\s+/g, " ").trim()}`)
  return [
    `Translate a transcript into ${targetLanguageName}.`,
    sourceLanguageName ? `The source language is ${sourceLanguageName}.` : "",
    "",
    "Rules:",
    `- Translate the text of every numbered line into ${targetLanguageName}.`,
    "- Return one entry per input line, with the same index. Never merge or split lines.",
    "- Translate meaning, not word for word. Keep the register of the speaker.",
    "- Keep proper nouns, product names and numbers as they are unless the target",
    "  language genuinely has its own form for them.",
    "- Do not add commentary, notes, timestamps, or speaker labels.",
    "- If a line is not speech, return it unchanged.",
    "",
    "Lines (index, tab, text):",
    ...lines,
  ]
    .filter(Boolean)
    .join("\n")
}

export type TranslateTranscriptInput = {
  config: GeminiMediaConfig
  segments: TranslatableSegment[]
  targetLanguageName: string
  sourceLanguageName?: string | null
  signal?: AbortSignal
}

export type TranslateTranscriptResult = {
  segments: TranslatableSegment[]
  fullText: string
  model: string
}

/**
 * Translate saved segments, keeping their timing.
 *
 * The result is built by walking the *original* segments and substituting text,
 * so a model that drops, reorders or hallucinates entries cannot corrupt the
 * timeline: anything it fails to return simply keeps its original words.
 */
export async function translateTranscript(
  input: TranslateTranscriptInput,
): Promise<TranslateTranscriptResult> {
  if (input.segments.length === 0) {
    return { segments: [], fullText: "", model: input.config.model }
  }

  const { text, model } = await runGeminiText(
    input.config,
    buildTranslationPrompt(
      input.segments,
      input.targetLanguageName,
      input.sourceLanguageName,
    ),
    TRANSLATION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    input.signal,
  )

  return { ...applyTranslation(input.segments, text), model }
}

/**
 * Merge a model reply back onto the original segments.
 *
 * Exported for its own tests: this is where timing is preserved, and it is
 * pure, so it can be proven without a provider.
 */
export function applyTranslation(
  original: TranslatableSegment[],
  modelText: string,
): { segments: TranslatableSegment[]; fullText: string } {
  let byIndex = new Map<number, string>()
  try {
    const parsed = JSON.parse(modelText) as {
      segments?: { index?: unknown; text?: unknown }[]
    }
    for (const entry of parsed.segments ?? []) {
      const index = Number(entry?.index)
      const value = typeof entry?.text === "string" ? entry.text.trim() : ""
      if (Number.isInteger(index) && value) byIndex.set(index, value)
    }
  } catch {
    byIndex = new Map()
  }

  const segments = original.map((segment, index) => ({
    // Timing and speaker come from the original, always.
    startMs: segment.startMs,
    ...(segment.endMs !== undefined ? { endMs: segment.endMs } : {}),
    ...(segment.speaker ? { speaker: segment.speaker } : {}),
    text: byIndex.get(index) ?? segment.text,
  }))

  return { segments, fullText: segments.map((s) => s.text).join("\n") }
}

/* ------------------------------------------------------------------ titles */

export const TITLE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    titles: { type: "array", items: { type: "string" } },
  },
  required: ["titles"],
} as const

export function buildTitlePrompt(transcriptText: string, count = 3): string {
  return [
    `Suggest ${count} titles for a video, based on what is actually said in it.`,
    "",
    "Each title should:",
    "- describe what the video is about, specifically",
    "- read naturally, as a library entry a person would recognise later",
    "- be roughly 4 to 12 words",
    "",
    "Never:",
    "- use quotation marks, emoji, or a file extension",
    "- use clickbait, hype, or a question the video does not answer",
    "- invent details that are not in the transcript",
    "",
    "Transcript:",
    transcriptText.slice(0, 20_000),
  ].join("\n")
}

export type SuggestTitlesInput = {
  config: GeminiMediaConfig
  transcriptText: string
  count?: number
  signal?: AbortSignal
}

export async function suggestTitles(
  input: SuggestTitlesInput,
): Promise<{ titles: string[]; model: string }> {
  const { text, model } = await runGeminiText(
    input.config,
    buildTitlePrompt(input.transcriptText, input.count ?? 3),
    TITLE_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    input.signal,
  )
  return { titles: parseTitles(text), model }
}

/**
 * Read titles out of a model reply, and refuse the ones that are not titles.
 *
 * Models reliably wrap in quotes and occasionally append the extension despite
 * being told not to, so the cleanup happens here rather than being trusted to
 * the prompt. Pure, so the rules are testable.
 */
export function parseTitles(modelText: string): string[] {
  let raw: unknown[] = []
  try {
    const parsed = JSON.parse(modelText) as { titles?: unknown }
    if (Array.isArray(parsed.titles)) raw = parsed.titles
  } catch {
    raw = []
  }

  const seen = new Set<string>()
  const titles: string[] = []
  for (const entry of raw) {
    if (typeof entry !== "string") continue
    const cleaned = entry
      .replace(/[\r\n]+/g, " ")
      // Surrounding quotes, straight or curly.
      .replace(/^\s*["'“”‘’]+|["'“”‘’]+\s*$/g, "")
      // A trailing extension the model added anyway.
      .replace(/\.(mp4|mov|mkv|webm|avi|m4v|mp3|wav|m4a)\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120)
    if (!cleaned) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    titles.push(cleaned)
  }
  return titles
}

/* --------------------------------------------------- dub script adaptation */

/**
 * Rewriting one line so it can be spoken in the time available.
 *
 * This exists because of a real failure: on a ten-second fixture, a faithful
 * Spanish translation of one line needed 14.7 seconds of speech for a 9-second
 * slot. Nothing downstream can fix that — 1.6x is past the rate at which speech
 * stays human, and pushing the line later produced a dub longer than its video.
 *
 * So the words change, not the timeline. And crucially the *saved translation*
 * does not change: a reader's Spanish transcript stays complete and faithful,
 * while the dub speaks a tighter version of the same line. Two representations,
 * one meaning.
 *
 * This is line-level localisation, not summarisation. It is never given the
 * whole transcript, and it is told plainly that dropping a fact is worse than
 * being slightly too long.
 */
export const DUB_ADAPTATION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string" },
    /** The model's own view of whether meaning survived. */
    lostMeaning: { type: "boolean" },
  },
  required: ["text"],
} as const

export function buildDubAdaptationPrompt(input: {
  text: string
  languageName: string
  /** Fraction of the current length to aim for, e.g. 0.7. */
  ratio: number
  targetMs: number
}): string {
  const percent = Math.round(input.ratio * 100)
  const seconds = (input.targetMs / 1000).toFixed(1)
  return [
    `Rewrite one line of ${input.languageName} dialogue so it can be spoken aloud in about ${seconds} seconds.`,
    `It currently takes too long to say. Aim for roughly ${percent}% of its present length.`,
    "",
    "Rules:",
    "- Keep the same meaning. This is dubbing, not summarising.",
    "- Keep every name, number, and specific fact exactly as given.",
    "- Invent nothing that is not already in the line.",
    "- Prefer shorter, more natural phrasing over dropping content.",
    `- It must read as something a person would actually say in ${input.languageName}.`,
    "- If it cannot be shortened without losing something important, return your",
    "  best attempt and set lostMeaning to true.",
    "",
    "Line:",
    input.text,
  ].join("\n")
}

export type AdaptDubLineInput = {
  config: GeminiMediaConfig
  text: string
  languageName: string
  ratio: number
  targetMs: number
  signal?: AbortSignal
}

export type AdaptDubLineResult = {
  /** The line to speak. Falls back to the original if nothing usable came back. */
  text: string
  adapted: boolean
  lostMeaning: boolean
}

export async function adaptDubLine(input: AdaptDubLineInput): Promise<AdaptDubLineResult> {
  // Nothing to do: the line already fits.
  if (input.ratio >= 1) return { text: input.text, adapted: false, lostMeaning: false }

  const { text } = await runGeminiText(
    input.config,
    buildDubAdaptationPrompt({
      text: input.text,
      languageName: input.languageName,
      ratio: input.ratio,
      targetMs: input.targetMs,
    }),
    DUB_ADAPTATION_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    input.signal,
  )
  return parseAdaptedLine(text, input.text)
}

/**
 * Read a rewrite, and refuse one that is not an improvement.
 *
 * A model that returns the same line, something longer, or something empty has
 * not helped; using it anyway would spend a second synthesis to reproduce the
 * problem. Pure, so the guard is testable without a provider.
 */
export function parseAdaptedLine(modelText: string, original: string): AdaptDubLineResult {
  try {
    const parsed = JSON.parse(modelText) as { text?: unknown; lostMeaning?: unknown }
    const candidate = typeof parsed.text === "string" ? parsed.text.replace(/\s+/g, " ").trim() : ""
    if (!candidate) return { text: original, adapted: false, lostMeaning: false }
    // Not shorter is not an adaptation.
    if (candidate.length >= original.trim().length) {
      return { text: original, adapted: false, lostMeaning: Boolean(parsed.lostMeaning) }
    }
    return { text: candidate, adapted: true, lostMeaning: Boolean(parsed.lostMeaning) }
  } catch {
    return { text: original, adapted: false, lostMeaning: false }
  }
}
