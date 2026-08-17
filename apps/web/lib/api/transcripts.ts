/**
 * Transcript API client.
 *
 * Thin on purpose. Everything about Gemini — the credential, the media upload,
 * the prompt, the parsing — lives behind these three endpoints, on the server.
 * The browser never holds a provider key and never talks to Google.
 */

import { fetchApi } from "@/lib/api/client"
import type { MediaTranscript, TranscriptSegment } from "@arciin/types"

/**
 * A saved translation of the transcript into one language.
 *
 * Carries the original's timings: translation is a text transformation, so the
 * timeline that makes a timestamp seek the video is the original's.
 */
export type TranscriptTranslation = {
  id: string
  language: string
  status: string
  provider: string | null
  model: string | null
  fullText: string | null
  segments: TranscriptSegment[]
  error: string | null
  /** The original moved after this was produced — offer a regenerate. */
  stale: boolean
  generatedAt: string | null
  updatedAt: string
}

export type TranscriptResponse = {
  transcript: MediaTranscript | null
  translations: TranscriptTranslation[]
  transcribable: boolean
}

export function getAssetTranscript(assetId: string, signal?: AbortSignal) {
  return fetchApi<TranscriptResponse>(`/assets/${assetId}/transcript`, { signal })
}

/**
 * Ask for a transcript.
 *
 * Queues a job and returns immediately with the pending row — the work outlives
 * this request, and the drawer follows the persisted state rather than holding
 * the response open.
 */
export function requestAssetTranscript(assetId: string, input?: { profileId?: string }) {
  return fetchApi<{ transcript: MediaTranscript }>(`/assets/${assetId}/transcript`, {
    method: "POST",
    body: input ?? {},
  })
}

/** Save a corrected transcript. Marks it edited so a regenerate warns first. */
export function saveAssetTranscript(
  assetId: string,
  input: { segments?: TranscriptSegment[]; fullText?: string },
) {
  return fetchApi<{ transcript: MediaTranscript }>(`/assets/${assetId}/transcript`, {
    method: "PATCH",
    body: input,
  })
}

/**
 * Translate the saved transcript.
 *
 * Text only: the server reads the stored segments, so the video is not
 * uploaded again and no audio is extracted. Loading a translation that already
 * exists never comes through here — it arrives with the transcript.
 */
export function requestTranscriptTranslation(
  assetId: string,
  input: { language: string; profileId?: string },
) {
  return fetchApi<{ translation: TranscriptTranslation }>(
    `/assets/${assetId}/transcript/translations`,
    { method: "POST", body: input },
  )
}

/**
 * Ask for title suggestions based on what the video says.
 *
 * Returns choices only. Renaming happens through the ordinary asset update, on
 * an explicit Apply — a suggestion must never rename anything by itself.
 */
export function requestTitleSuggestions(assetId: string, input?: { count?: number }) {
  return fetchApi<{ titles: string[]; model: string }>(`/assets/${assetId}/title-suggestions`, {
    method: "POST",
    body: input ?? {},
  })
}

/**
 * A generated dub: translated speech mixed over the preserved background.
 *
 * A third thing beside transcript and translation. Reading a translation never
 * makes one, and playing one never regenerates it.
 */
export type MediaDub = {
  id: string
  language: string
  status:
    | "PENDING"
    | "PREPARING"
    | "SEPARATING"
    | "SYNTHESIZING"
    | "MIXING"
    | "READY"
    | "FAILED"
    | "NEEDS_REVIEW"
  /** Honest wording for what the worker is doing right now. */
  stage: string | null
  error: string | null
  /**
   * Bounded, sanitised tool output. Shown only behind a disclosure — the raw
   * command dump used to be the whole error message.
   */
  errorDetail: string | null
  /**
   * A real counter from the tool doing the work, or null when a stage cannot
   * say. Never a client-side timer.
   */
  progressPercent: number | null
  progressCurrent: number | null
  progressTotal: number | null
  /** When the counter last moved. What makes a stall visible. */
  progressUpdatedAt: string | null
  provider: string | null
  model: string | null
  voiceProfiles: unknown
  backgroundStrategy: string | null
  reviewSegments: unknown
  hasAudio: boolean
  durationMs: number | null
  /** The words or voices moved after this audio was made. */
  stale: boolean
  generatedAt: string | null
  updatedAt: string
}

export type DubsResponse = {
  dubs: MediaDub[]
  /** False when this server has no separator, so dubbing cannot preserve background. */
  separatorAvailable: boolean
  dubbableLanguages: string[]
}

export function getAssetDubs(assetId: string, signal?: AbortSignal) {
  return fetchApi<DubsResponse>(`/assets/${assetId}/dubs`, { signal })
}

/**
 * Start a dub. Returns immediately with the pending row.
 *
 * The work outlives this request — and the panel that made it — so the UI
 * follows the persisted status rather than holding a promise open.
 */
export function requestAssetDub(
  assetId: string,
  input: { language: string; profileId?: string; voiceProfiles?: unknown[] },
) {
  return fetchApi<{ dub: MediaDub }>(`/assets/${assetId}/dubs`, {
    method: "POST",
    body: input,
  })
}

/** Where the player and the download button both point. */
export function dubAudioUrl(assetId: string, language: string): string {
  return `/api/assets/${assetId}/dubs/${encodeURIComponent(language)}/audio`
}

/**
 * The video with the dubbed audio, assembled on request.
 *
 * Not stored: a dubbed copy of a large film is the film again, per language,
 * and the video stream is copied rather than re-encoded so building it takes
 * seconds.
 */
export function dubVideoUrl(assetId: string, language: string): string {
  return `/api/assets/${assetId}/dubs/${encodeURIComponent(language)}/video`
}

/** Statuses that mean the worker is still busy. */
export function isDubRunning(status: MediaDub["status"]): boolean {
  return ["PENDING", "PREPARING", "SEPARATING", "SYNTHESIZING", "MIXING"].includes(status)
}

/** Statuses where audio exists and can be played. */
export function isDubPlayable(status: MediaDub["status"]): boolean {
  return status === "READY" || status === "NEEDS_REVIEW"
}
