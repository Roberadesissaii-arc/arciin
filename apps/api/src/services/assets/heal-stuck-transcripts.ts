import type { PrismaClient } from "@prisma/client"

/**
 * Heal MediaTranscript rows left PENDING/PROCESSING after the worker died.
 *
 * The drawer already self-heals from a FAILED Job on GET. The library card does
 * not open that route — it only reads the batched AI summary — so a hard-killed
 * worker left spinners on finished-dead work until a manual reload somehow
 * opened Assist. Healing here, on the listing path, is what clears the card.
 *
 * Rules (intentionally conservative):
 *   - linked Job FAILED / COMPLETED / missing → mark FAILED
 *   - Job still QUEUED/ACTIVE, but the worker heartbeat has been dead longer
 *     than WORKER_GONE_MS → mark FAILED (hard kill / crash)
 *
 * A brief PM2 restart under five minutes will not false-fail in-flight work.
 */

export const WORKER_GONE_MS = 5 * 60_000

export type HealableTranscript = {
  id: string
  assetId: string
  status: string
  jobId: string | null
  error: string | null
}

export type HealedTranscript = {
  transcriptId: string
  assetId: string
  error: string
}

export function isWorkerGone(
  heartbeatMs: number | null | undefined,
  now = Date.now(),
): boolean {
  if (heartbeatMs == null || !Number.isFinite(heartbeatMs)) return true
  return now - heartbeatMs > WORKER_GONE_MS
}

export function decideStuckTranscriptFailure(input: {
  job: { status: string; error: string | null } | null
  workerGone: boolean
}): string | null {
  const { job, workerGone } = input

  if (!job) {
    return workerGone
      ? "Transcript was abandoned (no job record; worker is offline)."
      : "Transcript job was lost."
  }

  if (job.status === "FAILED") {
    return job.error?.trim() || "Transcript generation failed."
  }

  if (job.status === "COMPLETED") {
    return "Transcript job finished without saving a result."
  }

  // QUEUED / ACTIVE — only give up when the worker itself is gone.
  if (workerGone) {
    return "Worker stopped while this transcript was running."
  }

  return null
}

/**
 * Mark stuck PENDING/PROCESSING rows FAILED and return what changed.
 *
 * Pure enough to unit-test the decision; DB writes stay here so callers stay thin.
 */
export async function healStuckTranscripts(
  prisma: PrismaClient,
  transcripts: HealableTranscript[],
  options: {
    workerHeartbeatMs?: number | null
    now?: number
  } = {},
): Promise<HealedTranscript[]> {
  const running = transcripts.filter(
    (t) => t.status === "PENDING" || t.status === "PROCESSING",
  )
  if (running.length === 0) return []

  const workerGone = isWorkerGone(options.workerHeartbeatMs, options.now)
  const jobIds = [...new Set(running.map((t) => t.jobId).filter(Boolean))] as string[]
  const jobs =
    jobIds.length > 0
      ? await prisma.job.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, status: true, error: true },
        })
      : []
  const jobById = new Map(jobs.map((j) => [j.id, j]))

  const healed: HealedTranscript[] = []

  for (const transcript of running) {
    const job = transcript.jobId ? (jobById.get(transcript.jobId) ?? null) : null
    const error = decideStuckTranscriptFailure({ job, workerGone })
    if (!error) continue

    await prisma.mediaTranscript.update({
      where: { id: transcript.id },
      data: { status: "FAILED", error },
    })
    healed.push({
      transcriptId: transcript.id,
      assetId: transcript.assetId,
      error,
    })
  }

  return healed
}
