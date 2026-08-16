/**
 * Transcript API client.
 *
 * Thin on purpose. Everything about Gemini — the credential, the media upload,
 * the prompt, the parsing — lives behind these three endpoints, on the server.
 * The browser never holds a provider key and never talks to Google.
 */

import { fetchApi } from "@/lib/api/client"
import type { MediaTranscript, TranscriptSegment } from "@arciin/types"

export type TranscriptResponse = {
  transcript: MediaTranscript | null
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
