import type { PrismaClient } from "@prisma/client"

import { languageName } from "@arciin/types"

/**
 * What a card needs to know about an asset's AI state.
 *
 * The obvious implementation is a request per card, and it is the wrong one: a
 * library page showing two hundred videos would fire two hundred requests to
 * draw two hundred badges. So this is answered in bulk — three queries for a
 * whole page, regardless of how many assets are on it — and folded into the
 * listing the page was already fetching.
 *
 * The shape is deliberately about *activity* rather than about dubbing. Dubbing
 * happens to be the first background AI operation with a card indicator;
 * transcription and translation will want the same treatment, and a field called
 * `isArabicDubRunning` would mean redesigning the card each time. So a card asks
 * "is something running, what is it called, how far along", and does not care
 * which subsystem answered.
 */

/** Statuses that mean a worker is still busy with a dub. */
const RUNNING_DUB_STATUSES = ["PENDING", "PREPARING", "SEPARATING", "SYNTHESIZING", "MIXING"]

/** Dub statuses where audio exists and can be played. */
const PLAYABLE_DUB_STATUSES = ["READY", "NEEDS_REVIEW"]

export type AssetAiActivity = {
  /** True while a worker is on it; false for a finished-badly state. */
  active: boolean
  /** Which operation. Open for transcripts and translations to join. */
  kind: "dub" | "transcript"
  /** Human, for a tooltip: "Arabic dub". Never an internal id. */
  label: string
  /** What the worker is doing right now, when it says. */
  stage: string | null
  /** 0-100 from the tool doing the work, or null when it cannot count. */
  percent: number | null
  current: number | null
  total: number | null
  /** When the counter last moved, so the card can tell slow from stopped. */
  updatedAt: string | null
  /**
   * The same rolling history the panel uses.
   *
   * Sent with the listing so a card can show remaining time without a request
   * of its own — the estimate is arithmetic over these, and duplicating that
   * arithmetic on the server would make the two views disagree between polls.
   */
  samples: { at: number; completed: number; total: number }[] | null
  status: "running" | "failed"
  /**
   * Which language to open. Lets clicking the indicator land on the dub that is
   * actually running instead of whichever one the panel would have defaulted to.
   */
  language: string | null
}

export type AssetAiSummary = {
  /**
   * Original plus translated, counted as one convention throughout.
   *
   * A Hindi video with English and Arabic translations is "3 languages". The
   * alternative — counting only translations — reads as though the original does
   * not exist, and the number on the card should match what a person would say
   * out loud about the file.
   */
  languageCount: number
  /** Languages with playable dubbed audio. */
  dubLanguages: string[]
  /** The one thing worth showing on the thumbnail, or nothing. */
  activity: AssetAiActivity | null
}

const EMPTY: AssetAiSummary = { languageCount: 0, dubLanguages: [], activity: null }

/**
 * AI state for a page of assets, in a fixed number of queries.
 *
 * Three, whatever the page size: transcripts for these assets, translations for
 * those transcripts, dubs for these assets.
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

  const dubs = await prisma.mediaDub.findMany({
    where: { assetId: { in: assetIds } },
    select: {
      assetId: true,
      language: true,
      status: true,
      stage: true,
      progressPercent: true,
      progressCurrent: true,
      progressTotal: true,
      progressUpdatedAt: true,
      progressSamples: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  })

  const transcriptByAsset = new Map(transcripts.map((t) => [t.assetId, t]))
  const translationsByTranscript = new Map<string, string[]>()
  for (const translation of translations) {
    const list = translationsByTranscript.get(translation.transcriptId) ?? []
    list.push(translation.language)
    translationsByTranscript.set(translation.transcriptId, list)
  }

  const dubsByAsset = new Map<string, typeof dubs>()
  for (const dub of dubs) {
    const list = dubsByAsset.get(dub.assetId) ?? []
    list.push(dub)
    dubsByAsset.set(dub.assetId, list)
  }

  for (const assetId of assetIds) {
    const transcript = transcriptByAsset.get(assetId)
    const translated = transcript ? (translationsByTranscript.get(transcript.id) ?? []) : []
    const assetDubs = dubsByAsset.get(assetId) ?? []

    // The original counts, and only once, and only when it is actually known.
    const hasOriginal = Boolean(transcript?.language)
    const languageCount = (hasOriginal ? 1 : 0) + new Set(translated).size

    summaries.set(assetId, {
      languageCount,
      dubLanguages: assetDubs
        .filter((d) => PLAYABLE_DUB_STATUSES.includes(d.status))
        .map((d) => d.language),
      activity: pickActivity(assetDubs, transcript),
    })
  }

  return summaries
}

/** Defensive: the column is JSON, and a malformed value must not break a page. */
function readSamples(raw: unknown): { at: number; completed: number; total: number }[] | null {
  if (!Array.isArray(raw)) return null
  const samples = raw.filter(
    (entry): entry is { at: number; completed: number; total: number } =>
      Boolean(entry) &&
      typeof entry === "object" &&
      typeof (entry as { at?: unknown }).at === "number" &&
      typeof (entry as { completed?: unknown }).completed === "number" &&
      typeof (entry as { total?: unknown }).total === "number",
  )
  return samples.length > 0 ? samples : null
}

/**
 * The single most important thing happening to this asset.
 *
 * One indicator, so it has to be ranked. Running beats finished-badly, because
 * a job in flight is the thing a person is waiting on; a dub beats a transcript
 * only because it is the longer wait and therefore the more useful thing to
 * report. A failure is shown when nothing is running, so a spinner never gets
 * stuck on a job that has already stopped.
 */
function pickActivity(
  dubs: {
    language: string
    status: string
    stage: string | null
    progressPercent: number | null
    progressCurrent: number | null
    progressTotal: number | null
    progressUpdatedAt: Date | null
    progressSamples: unknown
    updatedAt: Date
  }[],
  transcript: { language: string | null; status: string; updatedAt: Date } | undefined,
): AssetAiActivity | null {
  const runningDub = dubs.find((d) => RUNNING_DUB_STATUSES.includes(d.status))
  if (runningDub) {
    return {
      active: true,
      kind: "dub",
      label: `${languageName(runningDub.language) || runningDub.language} dub`,
      stage: runningDub.stage,
      percent: runningDub.progressPercent,
      current: runningDub.progressCurrent,
      total: runningDub.progressTotal,
      updatedAt: (runningDub.progressUpdatedAt ?? runningDub.updatedAt).toISOString(),
      samples: readSamples(runningDub.progressSamples),
      status: "running",
      language: runningDub.language,
    }
  }

  if (transcript && ["PENDING", "PROCESSING"].includes(transcript.status)) {
    return {
      active: true,
      kind: "transcript",
      label: "Transcript",
      stage: "Generating transcript",
      percent: null,
      current: null,
      total: null,
      updatedAt: transcript.updatedAt.toISOString(),
      samples: null,
      status: "running",
      language: null,
    }
  }

  const failedDub = dubs.find((d) => d.status === "FAILED")
  if (failedDub) {
    return {
      active: false,
      kind: "dub",
      label: `${languageName(failedDub.language) || failedDub.language} dub`,
      stage: null,
      percent: null,
      current: null,
      total: null,
      updatedAt: failedDub.updatedAt.toISOString(),
      samples: null,
      status: "failed",
      language: failedDub.language,
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
