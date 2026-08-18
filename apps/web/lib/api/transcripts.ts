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
 * Summary, keywords, and spoken links from the saved transcript.
 * Text only — the video is not uploaded again.
 */
export function requestTranscriptSummary(assetId: string, input?: { profileId?: string }) {
  return fetchApi<{
    summary: string
    keywords: string[]
    links: string[]
    model: string | null
    generatedAt: string | null
  }>(`/assets/${assetId}/transcript-summary`, {
    method: "POST",
    body: input ?? {},
  })
}
