/**
 * Resumable File Request uploads — the browser half.
 *
 * A file is sent as fixed-size chunks the server sizes (it returns chunkSize
 * when the session is created), each at an exact offset. Only one chunk's
 * Blob slice is read at a time: the file is never loaded into memory.
 *
 * When a chunk fails the upload does not start over. It waits (1s, 2s, 4s,
 * 8s, 16s), asks the server how much it actually has, and continues from
 * there. After five failures in a row it stops as "stalled" and the page
 * offers Resume, which does the same thing on demand.
 *
 * The loop takes a transport so it can be tested against a fake server; the
 * real one is `httpTransport` below.
 */

export type UploadSession = {
  uploadId: string
  status: string
  totalBytes: number
  uploadedBytes: number
  chunkSize: number
  expiresAt: string
}

export type CompleteResult = UploadSession & {
  fileName?: string
  submissionId?: string
  checksumSha256?: string
}

export class UploadHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = "UploadHttpError"
  }
}

/** Five tries without a single success; the caller shows "Resume upload". */
export class UploadStalledError extends Error {
  constructor(readonly lastError: unknown) {
    super("Unable to reconnect.")
    this.name = "UploadStalledError"
  }
}

export class UploadPausedError extends Error {
  constructor() {
    super("Paused")
    this.name = "UploadPausedError"
  }
}

export type FileMeta = {
  filename: string
  sizeBytes: number
  mimeType: string | null
  lastModified: number | null
}

export type ResumableTransport = {
  create(meta: FileMeta & Record<string, unknown>): Promise<UploadSession & { resumed?: boolean }>
  status(uploadId: string): Promise<UploadSession>
  putChunk(input: {
    uploadId: string
    offset: number
    body: Blob
    sha256: string | null
    onProgress: (sentInChunk: number) => void
    signal: AbortSignal
  }): Promise<{ uploadedBytes: number }>
  complete(uploadId: string, extra?: { submissionId?: string | null }): Promise<CompleteResult>
  cancel(uploadId: string): Promise<void>
}

export type UploadState =
  | "starting"
  | "uploading"
  | "reconnecting"
  | "verifying"
  | "done"

export const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000]

/** Failures worth waiting out: the connection, the proxy, or a busy server. */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof UploadHttpError)) return true // network / unknown
  if (error.status === 0) return true
  if ([408, 429, 500, 502, 503, 504].includes(error.status)) return true
  return error.code === "UPLOAD_VERIFYING" || error.code === "UPSTREAM_UNAVAILABLE"
}

async function chunkDigest(blob: Blob): Promise<string | null> {
  // crypto.subtle exists only in secure contexts (HTTPS / localhost). On a
  // plain-HTTP LAN page the chunk goes without a checksum; the server still
  // verifies size per chunk and SHA-256 of the whole file.
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined
  if (!subtle) return null
  const digest = await subtle.digest("SHA-256", await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

export async function runResumableUpload(input: {
  file: Blob & { name?: string }
  meta: FileMeta
  transport: ResumableTransport
  extra?: Record<string, unknown>
  /** An uploadId remembered from before a reload; tried before creating a new session. */
  knownUploadId?: string | null
  onSession?: (session: UploadSession) => void
  onProgress?: (uploadedBytes: number, totalBytes: number) => void
  /**
   * Bytes the server has confirmed holding — at the start or resume of the
   * session and after every acknowledged chunk. Unlike onProgress, which
   * counts bytes handed to the network, this only ever reports delivered
   * bytes, so it is what speed and time-remaining are measured from.
   */
  onConfirmed?: (confirmedBytes: number, totalBytes: number) => void
  onState?: (state: UploadState) => void
  /** Read at completion time: the submission another file may have created meanwhile. */
  submissionId?: () => string | null
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
}): Promise<CompleteResult> {
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const signal = input.signal ?? new AbortController().signal
  const checkAbort = () => {
    if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new UploadPausedError()
  }

  input.onState?.("starting")
  let session: UploadSession | null = null
  if (input.knownUploadId) {
    session = await input.transport.status(input.knownUploadId).catch(() => null)
    if (session && session.status !== "UPLOADING" && session.status !== "VERIFYING" && session.status !== "COMPLETE") {
      session = null
    }
  }
  if (!session) session = await input.transport.create({ ...input.meta, ...(input.extra ?? {}) })
  input.onSession?.(session)

  const total = session.totalBytes
  let offset = session.uploadedBytes
  input.onProgress?.(offset, total)
  input.onConfirmed?.(offset, total)

  let failures = 0
  const recover = async (error: unknown) => {
    if (!isRetryable(error)) throw error
    if (failures >= BACKOFF_MS.length) throw new UploadStalledError(error)
    // Roll the shown progress back to what the server last confirmed: the
    // bytes of the chunk in flight may never have arrived.
    input.onProgress?.(offset, total)
    input.onState?.("reconnecting")
    await sleep(BACKOFF_MS[failures]!)
    failures += 1
    checkAbort()
    // Ask, don't assume: the chunk may have landed even though the response was lost.
    const fresh = await input.transport.status(session!.uploadId)
    offset = fresh.uploadedBytes
    input.onProgress?.(offset, total)
    input.onConfirmed?.(offset, total)
  }

  if (session.status !== "COMPLETE") {
    while (offset < total) {
      checkAbort()
      input.onState?.("uploading")
      const end = Math.min(total, offset + session.chunkSize)
      const slice = input.file.slice(offset, end)
      try {
        const sha256 = await chunkDigest(slice)
        const base = offset
        const result = await input.transport.putChunk({
          uploadId: session.uploadId,
          offset,
          body: slice,
          sha256,
          signal,
          onProgress: (sent) => input.onProgress?.(base + sent, total),
        })
        offset = result.uploadedBytes
        failures = 0
        input.onProgress?.(offset, total)
        input.onConfirmed?.(offset, total)
      } catch (error) {
        if (signal.aborted) checkAbort()
        if (error instanceof UploadHttpError && error.code === "INVALID_UPLOAD_OFFSET") {
          // The server knows better; continue from where it is.
          const expected = Number(error.details?.expectedOffset)
          if (Number.isFinite(expected)) {
            offset = expected
            input.onProgress?.(offset, total)
            input.onConfirmed?.(offset, total)
            continue
          }
        }
        if (error instanceof UploadHttpError && error.code === "CHUNK_CHECKSUM_MISMATCH") {
          failures += 1
          if (failures > BACKOFF_MS.length) throw new UploadStalledError(error)
          continue // resend the same chunk
        }
        try {
          await recover(error)
        } catch (fatal) {
          // The status call itself can fail while the network is down.
          if (fatal instanceof UploadStalledError || !isRetryable(fatal)) throw fatal
          if (failures >= BACKOFF_MS.length) throw new UploadStalledError(fatal)
        }
      }
    }
  }

  input.onState?.("verifying")
  failures = 0
  for (;;) {
    checkAbort()
    try {
      const done = await input.transport.complete(session.uploadId, { submissionId: input.submissionId?.() ?? null })
      input.onState?.("done")
      return done
    } catch (error) {
      if (!isRetryable(error)) throw error
      if (failures >= BACKOFF_MS.length) throw new UploadStalledError(error)
      await sleep(BACKOFF_MS[failures]!)
      failures += 1
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP transport
// ---------------------------------------------------------------------------

async function jsonCall<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      credentials: "omit",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch {
    throw new UploadHttpError(0, "NETWORK", "Connection interrupted.")
  }
  let parsed: { data?: T; error?: { code?: string; message?: string; details?: Record<string, unknown> } } = {}
  try {
    parsed = await res.json()
  } catch {
    // A proxy's HTML error page: fall through with the status alone.
  }
  if (!res.ok || !parsed.data) {
    throw new UploadHttpError(
      res.status,
      parsed.error?.code ?? `HTTP_${res.status}`,
      parsed.error?.message ?? "The upload could not continue.",
      parsed.error?.details,
    )
  }
  return parsed.data
}

export function httpTransport(token: string, base = "/api"): ResumableTransport {
  const root = `${base}/public/file-requests/${encodeURIComponent(token)}/uploads`
  return {
    create: (meta) => jsonCall("POST", root, meta),
    status: (uploadId) => jsonCall("GET", `${root}/${encodeURIComponent(uploadId)}`),
    complete: (uploadId, extra) =>
      jsonCall("POST", `${root}/${encodeURIComponent(uploadId)}/complete`, {
        ...(extra?.submissionId ? { submissionId: extra.submissionId } : {}),
      }),
    cancel: async (uploadId) => {
      await jsonCall("DELETE", `${root}/${encodeURIComponent(uploadId)}`).catch(() => {})
    },
    putChunk: ({ uploadId, offset, body, sha256, onProgress, signal }) =>
      new Promise((resolve, reject) => {
        // XHR for upload progress, which fetch still cannot report.
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", `${root}/${encodeURIComponent(uploadId)}/chunks?offset=${offset}`)
        xhr.setRequestHeader("content-type", "application/octet-stream")
        if (sha256) xhr.setRequestHeader("x-chunk-sha256", sha256)
        xhr.upload.onprogress = (event) => onProgress(event.loaded)
        xhr.onload = () => {
          let parsed: { data?: { uploadedBytes: number }; error?: { code?: string; message?: string; details?: Record<string, unknown> } } = {}
          try {
            parsed = JSON.parse(xhr.responseText || "{}")
          } catch {
            // Cloudflare/HTML error page
          }
          if (xhr.status >= 200 && xhr.status < 300 && parsed.data) return resolve(parsed.data)
          reject(
            new UploadHttpError(
              xhr.status,
              parsed.error?.code ?? `HTTP_${xhr.status}`,
              parsed.error?.message ?? "The chunk was not accepted.",
              parsed.error?.details,
            ),
          )
        }
        xhr.onerror = () => reject(new UploadHttpError(0, "NETWORK", "Connection interrupted."))
        xhr.ontimeout = () => reject(new UploadHttpError(0, "NETWORK", "Connection interrupted."))
        const abort = () => xhr.abort()
        signal.addEventListener("abort", abort, { once: true })
        xhr.onabort = () => reject(signal.reason instanceof Error ? signal.reason : new UploadPausedError())
        xhr.send(body)
      }),
  }
}

// ---------------------------------------------------------------------------
// Remembering a session across a reload (never the file itself)
// ---------------------------------------------------------------------------

const RESUME_KEY = "arciin:file-request-resume:v1"

/** name + size + lastModified: enough to recognise the same file re-selected after a reload. */
export function fileFingerprint(token: string, meta: FileMeta): string {
  // Only the public prefix of the token is stored, not the whole secret.
  return `${token.slice(0, 12)}|${meta.filename}|${meta.sizeBytes}|${meta.lastModified ?? ""}`
}

function readStore(): Record<string, { uploadId: string; savedAt: number }> {
  try {
    return JSON.parse(localStorage.getItem(RESUME_KEY) || "{}")
  } catch {
    return {}
  }
}

function writeStore(store: Record<string, { uploadId: string; savedAt: number }>) {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(store))
  } catch {
    // storage blocked — resume still works server-side for the same network
  }
}

export function rememberUpload(fingerprint: string, uploadId: string) {
  const store = readStore()
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  for (const [k, v] of Object.entries(store)) if (v.savedAt < cutoff) delete store[k]
  store[fingerprint] = { uploadId, savedAt: Date.now() }
  writeStore(store)
}

export function recallUpload(fingerprint: string): string | null {
  return readStore()[fingerprint]?.uploadId ?? null
}

export function forgetUpload(fingerprint: string) {
  const store = readStore()
  delete store[fingerprint]
  writeStore(store)
}
