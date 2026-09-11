/**
 * Gemini, as a media-understanding provider.
 *
 * Deliberately a provider module rather than transcription-specific code: the
 * expensive parts — resolving a credential, getting bytes to Google, cleaning
 * up afterwards — are the same whether the question is "transcribe this",
 * "summarise this" or "where do they discuss pricing". Only the prompt and the
 * response schema change, so those are arguments.
 *
 * The credential is never in this file, never in the repository and never sent
 * to a browser. It comes from the encrypted `ModelProfile.apiKey` the instance
 * already uses for chat, decrypted by the Prisma wrapper on read.
 */

import { basename } from "node:path"
import { stat } from "node:fs/promises"

import { GoogleGenAI, type File as GeminiFile } from "@google/genai"
import type { PrismaClient } from "@prisma/client"

import { readModelApiKey } from "./model-key"

/** Default when the profile does not name one. Long-context, handles A/V. */
export const DEFAULT_GEMINI_MEDIA_MODEL = "gemini-2.5-flash"

/**
 * Above this, bytes go through the Files API instead of inline data.
 *
 * Inline parts are base64 inside the request JSON, which inflates by a third
 * and has to be held in memory twice. The Files API streams from a filesystem
 * path instead, so it is the right answer for anything but a very short clip.
 */
export const INLINE_UPLOAD_LIMIT_BYTES = 12 * 1024 * 1024

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super("GEMINI_NOT_CONFIGURED")
    this.name = "GeminiNotConfiguredError"
  }
}

export class GeminiUnsupportedMediaError extends Error {
  constructor(mimeType: string) {
    super(`Gemini media understanding does not accept MIME type "${mimeType}".`)
    this.name = "GeminiUnsupportedMediaError"
  }
}

export type GeminiMediaConfig = {
  apiKey: string
  model: string
  profileId: string
}

/**
 * The instance's Gemini credential.
 *
 * Same resolution order as text-to-speech already uses: an explicitly named
 * profile first, then the default enabled Gemini profile. Reused rather than
 * reimplemented so there is one place to configure Gemini, not two.
 */
export async function resolveGeminiMediaConfig(
  prisma: PrismaClient,
  profileId?: string,
): Promise<GeminiMediaConfig> {
  const where = profileId
    ? { id: profileId, isEnabled: true, provider: "gemini" }
    : { isEnabled: true, provider: "gemini", apiKey: { not: null } }

  const profile = await prisma.modelProfile.findFirst({
    where,
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, apiKey: true, defaultModel: true },
  })

  // Decrypted here, because the worker's Prisma client does not do it for us.
  const apiKey = readModelApiKey(profile?.apiKey)
  if (!profile || !apiKey) throw new GeminiNotConfiguredError()

  return {
    apiKey,
    model: profile.defaultModel?.trim() || DEFAULT_GEMINI_MEDIA_MODEL,
    profileId: profile.id,
  }
}

export type MediaUnderstandingInput = {
  config: GeminiMediaConfig
  /** Local path to the bytes Gemini should hear or watch. */
  filePath: string
  mimeType: string
  prompt: string
  /** JSON schema for structured output. Without it the model returns prose. */
  responseSchema?: Record<string, unknown>
  /** Called as the work moves, so a job can record honest progress. */
  onStage?: (stage: "uploading" | "analyzing") => void
  signal?: AbortSignal
}

export type MediaUnderstandingResult = {
  /** Raw model text — JSON when a schema was supplied. */
  text: string
  model: string
}

export type GeminiMediaTransport =
  | { mode: "inline"; sizeBytes: number; mimeType: string }
  | {
      mode: "filesApi"
      sizeBytes: number
      mimeType: string
      /** Filesystem path. The Node SDK stats and streams this — not a Blob. */
      file: string
      displayName: string
    }

export function isSupportedGeminiMediaMime(mimeType: string): boolean {
  const mime = mimeType.trim().toLowerCase()
  return mime.startsWith("audio/") || mime.startsWith("video/")
}

export function assertSupportedGeminiMediaMime(mimeType: string): void {
  if (!isSupportedGeminiMediaMime(mimeType)) {
    throw new GeminiUnsupportedMediaError(mimeType)
  }
}

/**
 * Choose inline base64 vs Files API from size. Equality stays inline — the
 * documented threshold is "larger than" the limit.
 */
export function planGeminiMediaTransport(input: {
  sizeBytes: number
  filePath: string
  mimeType: string
}): GeminiMediaTransport {
  assertSupportedGeminiMediaMime(input.mimeType)
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes < 0) {
    throw new Error("Media file size is unknown; refusing to upload.")
  }
  if (input.sizeBytes <= INLINE_UPLOAD_LIMIT_BYTES) {
    return { mode: "inline", sizeBytes: input.sizeBytes, mimeType: input.mimeType }
  }
  return {
    mode: "filesApi",
    sizeBytes: input.sizeBytes,
    mimeType: input.mimeType,
    file: input.filePath,
    displayName: basename(input.filePath) || "media",
  }
}

/**
 * Ask Gemini about a media file, and clean up after.
 *
 * The uploaded copy is deleted in a `finally`: Gemini's file store is a staging
 * area for one request, not somewhere Arciin keeps anything. Arciin remains the
 * system of record for the media, the transcript and the metadata.
 */
export async function runGeminiMediaUnderstanding(
  input: MediaUnderstandingInput,
): Promise<MediaUnderstandingResult> {
  const ai = new GoogleGenAI({ apiKey: input.config.apiKey })
  const size = (await stat(input.filePath)).size
  const transport = planGeminiMediaTransport({
    sizeBytes: size,
    filePath: input.filePath,
    mimeType: input.mimeType,
  })

  let uploaded: GeminiFile | null = null
  try {
    let mediaPart: Record<string, unknown>

    if (transport.mode === "inline") {
      // Small enough that a round trip through the Files API costs more than it
      // saves. Read once, send once.
      const { readFile } = await import("node:fs/promises")
      const bytes = await readFile(input.filePath)
      mediaPart = {
        inlineData: { mimeType: transport.mimeType, data: bytes.toString("base64") },
      }
    } else {
      input.onStage?.("uploading")
      // Node SDK: `file` is a filesystem path or a Blob. A ReadStream is
      // neither — it has no `size`, so the Files API received size_bytes:
      // undefined. Passing the path lets NodeUploader.stat + uploadFileFromPath
      // stream from disk.
      uploaded = await ai.files.upload({
        file: transport.file,
        config: {
          mimeType: transport.mimeType,
          displayName: transport.displayName,
          abortSignal: input.signal,
        },
      })

      // The file is not usable until Google finishes processing it.
      const deadline = Date.now() + 10 * 60_000
      let current = uploaded
      while (current.state === "PROCESSING") {
        if (Date.now() > deadline) throw new Error("Gemini took too long to accept the media.")
        if (input.signal?.aborted) throw new Error("Cancelled.")
        await new Promise((r) => setTimeout(r, 3000))
        current = await ai.files.get({ name: current.name! })
      }
      if (current.state === "FAILED") {
        throw new Error("Gemini could not process this media file.")
      }
      uploaded = current
      mediaPart = { fileData: { mimeType: transport.mimeType, fileUri: current.uri! } }
    }

    input.onStage?.("analyzing")
    const response = await ai.models.generateContent({
      model: input.config.model,
      contents: [{ role: "user", parts: [mediaPart, { text: input.prompt }] }],
      config: {
        ...(input.responseSchema
          ? {
              responseMimeType: "application/json",
              responseSchema: input.responseSchema as never,
            }
          : {}),
        // Transcription is a reading task, not a creative one.
        temperature: 0,
      },
    })

    return { text: response.text ?? "", model: input.config.model }
  } finally {
    if (uploaded?.name) {
      // Best effort: a leftover staging file is untidy, not a failure worth
      // losing a finished transcript over.
      await ai.files.delete({ name: uploaded.name }).catch(() => {})
    }
  }
}
