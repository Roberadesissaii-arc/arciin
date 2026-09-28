import type { FastifyInstance } from "fastify"

import type { FolderIncomingSummary, IncomingPhase } from "@arciin/shared"

import { buildRealtimeEvent } from "@/services/events/publish-event"
import { forgetProgress, summarizeIncoming } from "@/services/file-requests/incoming-summary"

export {
  INCOMING_PROGRESS_INTERVAL_MS,
  INCOMING_STALE_MS,
  progressDue,
  summarizeIncoming,
  type IncomingSessionRow,
} from "@/services/file-requests/incoming-summary"

/**
 * What a folder is receiving through File Requests, for the owner's own view.
 *
 * The owner used to learn about an upload only when it finished: a
 * multi-gigabyte transfer could run for an hour with the folder showing
 * nothing. This is the authoritative answer to "is anything arriving here, and
 * how far along is it" — read on page load and after every reconnect, and
 * pushed over the existing authenticated socket while it changes.
 *
 * Only counts and byte totals leave here. Never the request token, the
 * submitter's name or email, or a file name: the folder grid is not the place
 * those belong, and a summary with nothing sensitive in it cannot leak it.
 */

const ACTIVE = ["UPLOADING", "VERIFYING"] as const

/** Open sessions on requests this user created, optionally narrowed to one library or folder. */
export async function loadIncomingForUser(
  fastify: FastifyInstance,
  input: { userId: string; libraryId?: string; folderId?: string },
): Promise<FolderIncomingSummary[]> {
  const now = new Date()
  const sessions = await fastify.prisma.resumableUpload.findMany({
    where: {
      status: { in: [...ACTIVE] },
      expiresAt: { gt: now },
      fileRequest: {
        createdByUserId: input.userId,
        // A revoked link's uploads are over, even before cleanup closes them.
        revokedAt: null,
        status: { not: "REVOKED" },
        ...(input.libraryId ? { destinationLibraryId: input.libraryId } : {}),
        ...(input.folderId ? { destinationFolderId: input.folderId } : {}),
      },
    },
    select: {
      status: true,
      sizeBytes: true,
      receivedBytes: true,
      updatedAt: true,
      expiresAt: true,
      fileRequest: { select: { destinationFolderId: true, destinationLibraryId: true } },
    },
    take: 500,
  })
  return summarizeIncoming(
    sessions.map((s) => ({
      status: s.status,
      sizeBytes: s.sizeBytes,
      receivedBytes: s.receivedBytes,
      updatedAt: s.updatedAt,
      expiresAt: s.expiresAt,
      folderId: s.fileRequest.destinationFolderId,
      libraryId: s.fileRequest.destinationLibraryId,
    })),
    now.getTime(),
  )
}

/**
 * Tell the request's owner that a folder's incoming state changed.
 *
 * The event carries the folder's fresh summary, so a client can apply it
 * without a round-trip; the snapshot endpoint stays the source of truth for a
 * client that missed events. Best effort: a failed publish never fails the
 * upload it describes.
 */
export async function publishIncoming(
  fastify: FastifyInstance,
  input: {
    phase: IncomingPhase
    uploadId: string
    ownerUserId: string
    folderId: string
    libraryId: string
  },
): Promise<void> {
  if (input.phase !== "started" && input.phase !== "progress") forgetProgress(input.uploadId)
  try {
    const [summary] = await loadIncomingForUser(fastify, { userId: input.ownerUserId, folderId: input.folderId })
    const folder: FolderIncomingSummary = summary ?? {
      folderId: input.folderId,
      libraryId: input.libraryId,
      activeUploadCount: 0,
      totalBytes: 0,
      receivedBytes: 0,
      progressPercent: 100,
      state: "IDLE",
    }
    await fastify.publishRealtimeEvent(
      buildRealtimeEvent("file-request.incoming", {
        // The owner's own room only: not the library room, not the instance feed.
        userId: input.ownerUserId,
        audience: "user",
        data: { phase: input.phase, folder },
      }),
    )
  } catch (error) {
    fastify.log.debug({ err: error, uploadId: input.uploadId }, "incoming upload event not published")
  }
}
