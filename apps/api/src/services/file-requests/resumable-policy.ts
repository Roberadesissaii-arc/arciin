/**
 * Rules for resumable File Request uploads, kept free of I/O so each can be
 * unit-tested on its own. The routes and the chunk writer call these; nothing
 * here touches the database or the disk.
 */

export const MIB = 1024 * 1024
export const GIB = 1024 * MIB

/**
 * 16 MiB: far below Cloudflare's proxied request-body ceiling (100 MB on the
 * plans a Quick Tunnel runs under), small enough that a retry after a dropped
 * connection repeats seconds of work rather than minutes, and large enough
 * that a 2 GB file is 128 requests rather than thousands.
 */
export const DEFAULT_CHUNK_SIZE_BYTES = 16 * MIB
const MIN_CHUNK_MB = 1
const MAX_CHUNK_MB = 64

/** ARCIIN_UPLOAD_CHUNK_SIZE_MB, clamped to 1–64 MiB. The browser always uses what the server returns. */
export function resolveChunkSizeBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ARCIIN_UPLOAD_CHUNK_SIZE_MB)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_CHUNK_SIZE_BYTES
  const mb = Math.min(MAX_CHUNK_MB, Math.max(MIN_CHUNK_MB, Math.floor(raw)))
  return mb * MIB
}

export const DEFAULT_SESSION_LIFETIME_HOURS = 24

export function resolveSessionLifetimeMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.ARCIIN_UPLOAD_SESSION_HOURS)
  const hours = Number.isFinite(raw) && raw >= 1 && raw <= 168 ? raw : DEFAULT_SESSION_LIFETIME_HOURS
  return hours * 60 * 60 * 1000
}

/** Open resumable sessions allowed at once — per request, and per submitter within it. */
export const MAX_ACTIVE_SESSIONS_PER_REQUEST = 6
export const MAX_ACTIVE_SESSIONS_PER_SUBMITTER = 3
/** Chunk requests per session per minute: 2 GB at 16 MiB is 128 chunks, so this is generous. */
export const MAX_CHUNK_REQUESTS_PER_MINUTE = 240

/** The exact length the chunk at `offset` must have. */
export function expectedChunkLength(totalBytes: number, offset: number, chunkSize: number): number {
  return Math.max(0, Math.min(chunkSize, totalBytes - offset))
}

export type ChunkPlacement =
  | { kind: "append" }
  | { kind: "duplicate" }
  | { kind: "invalid"; expectedOffset: number }

/**
 * Where a chunk at `offset` fits, given what has been received.
 *
 * Chunks are written in order. A chunk the server already has (its response
 * was lost and the client retried) is acknowledged without being written
 * again, so a retry can never append the same bytes twice. Anything else —
 * a gap, an overlap, an offset off the chunk grid — is refused with the
 * offset the client should resume from.
 */
export function placeChunk(input: {
  offset: number
  receivedBytes: number
  totalBytes: number
  chunkSize: number
}): ChunkPlacement {
  const { offset, receivedBytes, totalBytes, chunkSize } = input
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= Math.max(totalBytes, 1)) {
    return { kind: "invalid", expectedOffset: receivedBytes }
  }
  if (offset % chunkSize !== 0) return { kind: "invalid", expectedOffset: receivedBytes }
  if (offset === receivedBytes) return { kind: "append" }
  if (offset < receivedBytes) return { kind: "duplicate" }
  return { kind: "invalid", expectedOffset: receivedBytes }
}

/**
 * Free space left over after every open upload has what it still needs.
 *
 * `outstandingBytes` is the bytes other open sessions have yet to receive:
 * what they already hold is already on disk and already out of
 * `availableBytes`, so counting their full size would double-count it.
 */
export function capacityDecision(input: {
  requestedBytes: number
  availableBytes: number | null
  outstandingBytes: number
  totalBytes: number | null
}):
  | { ok: true }
  | { ok: false; requiredBytes: number; availableBytes: number } {
  if (input.availableBytes == null) {
    // Cannot measure the disk: refuse rather than guess, the failure mode of
    // guessing wrong being a full disk under a running server.
    return { ok: false, requiredBytes: input.requestedBytes, availableBytes: 0 }
  }
  const margin = safetyMarginBytes(input.totalBytes)
  const usable = input.availableBytes - input.outstandingBytes - margin
  const required = input.requestedBytes
  if (required <= usable) return { ok: true }
  return {
    ok: false,
    requiredBytes: required + margin,
    availableBytes: Math.max(0, input.availableBytes - input.outstandingBytes),
  }
}

/** Keep at least 1 GiB or 2% of the filesystem free, whichever is larger. */
export function safetyMarginBytes(totalBytes: number | null): number {
  const fraction = totalBytes && totalBytes > 0 ? Math.floor(totalBytes * 0.02) : 0
  return Math.max(GIB, fraction)
}

/** Upload ids are server-generated cuids; anything else is not a file name we will build. */
export function isSafeUploadId(id: string): boolean {
  return /^[a-z0-9]{20,40}$/.test(id)
}
