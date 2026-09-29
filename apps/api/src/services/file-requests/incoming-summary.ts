import type { FolderIncomingSummary } from "@arciin/shared"

/**
 * The pure half of incoming-uploads.ts: grouping open sessions into per-folder
 * summaries and throttling progress. No database, no I/O.
 */

/**
 * No bytes for this long and an upload is "waiting", not "receiving". A 16 MiB
 * chunk over a ~5 Mbps uplink takes ~30 s and was seen at 89 s, so this sits
 * well above one slow chunk.
 */
export const INCOMING_STALE_MS = 2 * 60 * 1000
/** Progress is published at most this often per upload. */
export const INCOMING_PROGRESS_INTERVAL_MS = 1500

export type IncomingSessionRow = {
  status: string
  sizeBytes: bigint | number
  receivedBytes: bigint | number
  updatedAt: Date
  expiresAt: Date
  folderId: string
  libraryId: string
}

/** Group open sessions by destination folder. Pure. */
export function summarizeIncoming(rows: IncomingSessionRow[], now: number): FolderIncomingSummary[] {
  const byFolder = new Map<string, FolderIncomingSummary & { receiving: number; verifying: number }>()
  for (const row of rows) {
    if (row.status !== "UPLOADING" && row.status !== "VERIFYING") continue
    if (row.expiresAt.getTime() <= now) continue
    let entry = byFolder.get(row.folderId)
    if (!entry) {
      entry = {
        folderId: row.folderId,
        libraryId: row.libraryId,
        activeUploadCount: 0,
        totalBytes: 0,
        receivedBytes: 0,
        progressPercent: 0,
        state: "WAITING",
        receiving: 0,
        verifying: 0,
      }
      byFolder.set(row.folderId, entry)
    }
    const size = Number(row.sizeBytes)
    entry.activeUploadCount += 1
    entry.totalBytes += size
    entry.receivedBytes += Math.min(Number(row.receivedBytes), size)
    if (row.status === "VERIFYING") entry.verifying += 1
    else if (now - row.updatedAt.getTime() < INCOMING_STALE_MS) entry.receiving += 1
  }
  return [...byFolder.values()].map(({ receiving, verifying, ...entry }) => ({
    ...entry,
    // By bytes, so one large file is not outvoted by several small ones.
    progressPercent: entry.totalBytes > 0 ? Math.min(100, Math.floor((entry.receivedBytes / entry.totalBytes) * 100)) : 100,
    state: receiving > 0 ? "RECEIVING" : verifying > 0 ? "VERIFYING" : "WAITING",
  }))
}

const lastProgressAt = new Map<string, number>()

/** Whether a progress update for this upload is due. Completion of the last chunk always is. */
export function progressDue(uploadId: string, now: number, finished: boolean): boolean {
  const last = lastProgressAt.get(uploadId)
  if (!finished && last != null && now - last < INCOMING_PROGRESS_INTERVAL_MS) return false
  lastProgressAt.set(uploadId, now)
  // Bounded: ids of finished uploads are dropped when they end, and this is a
  // backstop against ones that never do.
  if (lastProgressAt.size > 5000) lastProgressAt.delete(lastProgressAt.keys().next().value!)
  return true
}

export function forgetProgress(uploadId: string): void {
  lastProgressAt.delete(uploadId)
}
