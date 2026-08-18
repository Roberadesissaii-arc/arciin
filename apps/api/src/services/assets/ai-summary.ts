import type { PrismaClient } from "@prisma/client"

/**
 * What a card needs to know about an asset's AI state.
 *
 * The obvious implementation is a request per card, and it is the wrong one: a
 * library page showing two hundred videos would fire two hundred requests to
 * draw two hundred badges. So this is answered in bulk — two queries for a
 * whole page, regardless of how many assets are on it — and folded into the
 * listing the page was already fetching.
 *
 * The shape is deliberately about *activity* rather than about any one
 * operation. Transcription happens to be the background job with a card
 * indicator today; a field called `isTranscriptRunning` would mean redesigning
 * the card the next time something else learns to run in the background. So a
 * card asks "is something running, what is it called, how far along", and does
 * not care which subsystem answered.
 */

export type AssetAiActivity = {
  /** True while a worker is on it; false for a finished-badly state. */
  active: boolean
  /** Which operation. Open for translations and whatever comes next to join. */
  kind: "transcript"
  /** Human, for a tooltip. Never an internal id. */
  label: string
  /** What the worker is doing right now, when it says. */
  stage: string | null
  /** When the state last moved, so the card can tell slow from stopped. */
  updatedAt: string | null
  status: "running" | "failed"
}

export type AssetAiSummary = {
  /**
   * Original plus translated, counted as one convention throughout.
   *
   * A Hindi video with English and Arabic translations is "3 languages". The
   * alternative — counting only translations — reads as though the original does
   * not exist, and the number on the card should match what a person would say
   * out loud about the file.
   *
   * Derived from the transcript and its translations alone: it is a statement
   * about what has been *written down*, and nothing else has ever needed to
   * affect it.
   */
  languageCount: number
  /** The one thing worth showing on the thumbnail, or nothing. */
  activity: AssetAiActivity | null
}

const EMPTY: AssetAiSummary = { languageCount: 0, activity: null }

/**
 * AI state for a page of assets, in a fixed number of queries.
 *
 * Two, whatever the page size: transcripts for these assets, and translations
 * for those transcripts.
 */
export async function loadAssetAiSummaries(
  prisma: PrismaClient,
  assetIds: string[],
): Promise<Map<string, AssetAiSummary>> {
  const summaries = new Map<string, AssetAiSummary>()
  if (assetIds.length === 0) return summaries

  const transcripts = await prisma.mediaTranscript.findMany({
    where: { assetId: { in: assetIds } },
    select: { id: true, assetId: true, language: true, status: true, updatedAt: true },
  })

  const translations =
    transcripts.length > 0
      ? await prisma.mediaTranslation.findMany({
          where: {
            transcriptId: { in: transcripts.map((t) => t.id) },
            status: "READY",
          },
          select: { transcriptId: true, language: true },
        })
      : []

  const transcriptByAsset = new Map(transcripts.map((t) => [t.assetId, t]))
  const translationsByTranscript = new Map<string, string[]>()
  for (const translation of translations) {
    const list = translationsByTranscript.get(translation.transcriptId) ?? []
    list.push(translation.language)
    translationsByTranscript.set(translation.transcriptId, list)
  }

  for (const assetId of assetIds) {
    const transcript = transcriptByAsset.get(assetId)
    const translated = transcript ? (translationsByTranscript.get(transcript.id) ?? []) : []

    // The original counts, and only once, and only when it is actually known.
    const hasOriginal = Boolean(transcript?.language)
    const languageCount = (hasOriginal ? 1 : 0) + new Set(translated).size

    summaries.set(assetId, {
      languageCount,
      activity: pickActivity(transcript),
    })
  }

  return summaries
}

/**
 * The single most important thing happening to this asset.
 *
 * One indicator, so it has to be ranked. Running beats finished-badly, because
 * a job in flight is the thing a person is waiting on; a failure is shown when
 * nothing is running, so a spinner never gets stuck on a job that has already
 * stopped.
 */
function pickActivity(
  transcript: { language: string | null; status: string; updatedAt: Date } | undefined,
): AssetAiActivity | null {
  if (!transcript) return null

  if (["PENDING", "PROCESSING"].includes(transcript.status)) {
    return {
      active: true,
      kind: "transcript",
      label: "Transcript",
      stage: "Generating transcript",
      updatedAt: transcript.updatedAt.toISOString(),
      status: "running",
    }
  }

  if (transcript.status === "FAILED") {
    return {
      active: false,
      kind: "transcript",
      label: "Transcript",
      stage: null,
      updatedAt: transcript.updatedAt.toISOString(),
      status: "failed",
    }
  }

  return null
}

/** Attach summaries to already-serialised assets. */
export function withAiSummaries<T extends { id: string }>(
  items: T[],
  summaries: Map<string, AssetAiSummary>,
): (T & { ai: AssetAiSummary })[] {
  return items.map((item) => ({ ...item, ai: summaries.get(item.id) ?? EMPTY }))
}
